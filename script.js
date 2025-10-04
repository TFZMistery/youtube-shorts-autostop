// ==UserScript==
// @name         YouTube Shorts AutoPause (Seconds or Loops) + Logs
// @namespace    https://tampermonkey.net/
// @version      1.1.1
// @description  Auto-pause YouTube Shorts after X seconds or X loops; handles SPA navigation, resets on new Shorts (even when same <video> is reused), and logs actions.
// @author       TFZMistery
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ========= CONFIG =========
  // MODE: 'seconds' or 'loops'
  const MODE = 'loops';

  // If MODE === 'seconds': pause after this many seconds of actual playback
  const SECONDS_LIMIT = 25;

  // If MODE === 'loops': pause after this many full loops
  const LOOPS_LIMIT = 3;

  // Logging
  const DEBUG = true;

  // ========= INTERNAL STATE =========
  let currentVideo = null;
  let currentRenderer = null;
  let state = null;
  let shortsObserver = null;
  let activePoll = null;
  let bootPoll = null;
  let currentShortsPath = null;

  function log(...args) {
    if (!DEBUG) return;
    try {
      console.log('%c[YSAP]', 'color:#7b61ff;font-weight:bold', ...args);
    } catch (_) {}
  }

  function isShortsPage() {
    return location.pathname.startsWith('/shorts');
  }

  function getShortsRoot() {
    return document.querySelector('ytd-shorts, #shorts-container, #shorts-inner-container') || document;
  }

  function findActiveRenderer() {
    let active = document.querySelector('ytd-reel-video-renderer[is-active=""]') ||
                 document.querySelector('ytd-reel-video-renderer[is-active]');
    if (active) return active;

    const candidates = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
    if (candidates.length === 0) return null;

    const viewportCenterY = window.innerHeight / 2;
    let best = null;
    let bestScore = -Infinity;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const center = Math.min(Math.max(viewportCenterY, r.top), r.bottom);
      const overlap = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      const score = overlap - Math.abs(center - viewportCenterY);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function getVideoFromRenderer(renderer) {
    if (!renderer) return null;
    const vid = renderer.querySelector('video');
    return vid instanceof HTMLVideoElement ? vid : null;
  }

  function setActiveVideoFromDOM(reason) {
    if (!isShortsPage()) {
      detachFromCurrentVideo('left-shorts');
      return;
    }

    const nextRenderer = findActiveRenderer();
    const nextVideo = getVideoFromRenderer(nextRenderer);

    if (!nextVideo) {
      log('No active Shorts video found yet (reason:', reason, ')');
      return;
    }

    const pathChanged = currentShortsPath !== location.pathname;

    // If YouTube reuses the same <video>, still reset when path changes or on new metadata
    if (nextVideo === currentVideo) {
      if (pathChanged) {
        currentShortsPath = location.pathname;
        resetState('path-changed-same-video');
      }
      return;
    }

    // New element detected
    currentShortsPath = location.pathname;
    log('New active Shorts video detected (reason:', reason, ')');
    setActiveVideo(nextVideo, nextRenderer);
  }

  function resetState(why) {
    if (!currentVideo) return;
    const ct = Number.isFinite(currentVideo.currentTime) ? currentVideo.currentTime : 0;
    state = {
      playedSeconds: 0,
      loopsCount: 0,
      lastTime: ct,
      pausedByScript: false,
      lastNearEnd: false,
      resetAtMs: performance.now(),
    };
    log('State reset (', why, '). t=', fmtTime(ct), 'url=', location.pathname);
  }

  function setActiveVideo(video, renderer) {
    detachFromCurrentVideo('switch');

    currentVideo = video;
    currentRenderer = renderer || (video ? video.closest('ytd-reel-video-renderer') : null);

    // Listeners
    currentVideo.addEventListener('timeupdate', handleTimeUpdate, { passive: true });
    currentVideo.addEventListener('ended', onEnded, { passive: true });
    currentVideo.addEventListener('seeking', onSeeking, { passive: true });
    currentVideo.addEventListener('pause', onPause, { passive: true });
    currentVideo.addEventListener('playing', onPlaying, { passive: true });
    currentVideo.addEventListener('loadedmetadata', onLoadedMetadata, { passive: true });

    resetState('attach');
    log('Attached to video. MODE:', MODE, MODE === 'seconds' ? `limit=${SECONDS_LIMIT}s` : `limit=${LOOPS_LIMIT} loops`);
  }

  function detachFromCurrentVideo(why) {
    if (!currentVideo) return;
    try {
      currentVideo.removeEventListener('timeupdate', handleTimeUpdate);
      currentVideo.removeEventListener('ended', onEnded);
      currentVideo.removeEventListener('seeking', onSeeking);
      currentVideo.removeEventListener('pause', onPause);
      currentVideo.removeEventListener('playing', onPlaying);
      currentVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
    } catch (_) {}
    log('Detached from video (reason:', why, '). Final state:', state);
    currentVideo = null;
    currentRenderer = null;
    state = null;
  }

  function onLoadedMetadata() {
    // New media loaded into same element (typical when scrolling). Reset state.
    resetState('loadedmetadata');
  }

  function onPlaying() {
    if (!currentVideo || !state) return;
    log('Video playing. t=', fmtTime(currentVideo.currentTime), 'dur=', fmtTime(currentVideo.duration));
  }

  function onPause() {
    if (!currentVideo || !state) return;
    log('Video paused. pausedByScript=', !!state.pausedByScript);
  }

  function onEnded() {
    if (!currentVideo || !state) return;
    state.loopsCount += 1;
    log('Loop detected via ended(). loops=', state.loopsCount);
    if (MODE === 'loops' && state.loopsCount >= LOOPS_LIMIT) {
      pauseCurrent('loops-ended');
    }
  }

  function onSeeking() {
    if (!currentVideo || !state) return;
    const ct = currentVideo.currentTime || 0;
    if (ct < 0.15 && state.lastTime > 0.8) {
      state.loopsCount += 1;
      log('Loop detected via seeking reset. loops=', state.loopsCount);
      if (MODE === 'loops' && state.loopsCount >= LOOPS_LIMIT) {
        pauseCurrent('loops-seeking');
      }
    }
  }

  function handleTimeUpdate() {
    if (!currentVideo || !state) return;

    // Do nothing after we've paused this Short
    if (state.pausedByScript) return;

    const ct = Number.isFinite(currentVideo.currentTime) ? currentVideo.currentTime : 0;
    const dur = Number.isFinite(currentVideo.duration) ? currentVideo.duration : 0;

    // If path changed but same element was kept and our other hooks missed it
    if (currentShortsPath !== location.pathname && isShortsPage()) {
      currentShortsPath = location.pathname;
      resetState('path-change-detected-in-timeupdate');
    }

    // Suppress false wrap detection briefly after a reset/metadata change
    const recentlyReset = (performance.now() - (state.resetAtMs || 0)) < 1500;

    // Detect loop by wrap-around
    const wrapped = !recentlyReset && state.lastTime > 0.8 && ct + 0.1 < state.lastTime;

    if (wrapped) {
      state.loopsCount += 1;
      log('Loop detected via wrap. last=', fmtTime(state.lastTime), 'now=', fmtTime(ct), 'loops=', state.loopsCount);
      if (MODE === 'loops' && state.loopsCount >= LOOPS_LIMIT) {
        pauseCurrent('loops-wrap');
        return;
      }
    }

    if (MODE === 'seconds') {
      const forwardDelta = Math.max(0, ct - (wrapped ? 0 : state.lastTime));
      state.playedSeconds += forwardDelta;

      if (wrapped && dur > 0) {
        state.playedSeconds += Math.max(0, dur - state.lastTime);
      }

      if (state.playedSeconds >= SECONDS_LIMIT) {
        log('Seconds limit reached:', state.playedSeconds.toFixed(2), '>=', SECONDS_LIMIT);
        pauseCurrent('seconds');
        return;
      }
    }

    if (dur > 0) {
      state.lastNearEnd = (dur - ct) < 0.2;
    }

    state.lastTime = ct;
  }

  function pauseCurrent(reason) {
    if (!currentVideo || !state) return;
    if (state.pausedByScript) return;
    state.pausedByScript = true;
    try {
      currentVideo.pause();
      log('Paused video. reason=', reason);
    } catch (e) {
      log('Pause() threw error; muting as fallback. reason=', reason, 'err=', e);
      try { currentVideo.muted = true; } catch (_) {}
    }
  }

  function onRouteChange(tag) {
    log('Route change event:', tag, 'path=', location.pathname);
    if (!isShortsPage()) {
      stopShortsObservers();
      detachFromCurrentVideo('route-away');
      currentShortsPath = null;
      return;
    }
    // Entering or changing Shorts
    if (currentShortsPath !== location.pathname) {
      currentShortsPath = location.pathname;
      // If same element will be reused, handleTimeUpdate and loadedmetadata will reset as well.
    }
    startShortsObservers();
    setActiveVideoFromDOM('route-change');
  }

  function startShortsObservers() {
    if (shortsObserver) return;

    shortsObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'is-active')) {
          setActiveVideoFromDOM('attr-change');
          return;
        }
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          setActiveVideoFromDOM('childlist-change');
          return;
        }
      }
    });

    const root = getShortsRoot();
    shortsObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['is-active'],
    });

    if (!activePoll) {
      activePoll = setInterval(() => setActiveVideoFromDOM('poll'), 1000);
    }

    log('Shorts observers started.');
  }

  function stopShortsObservers() {
    if (shortsObserver) {
      try { shortsObserver.disconnect(); } catch (_) {}
      shortsObserver = null;
    }
    if (activePoll) {
      clearInterval(activePoll);
      activePoll = null;
    }
    log('Shorts observers stopped.');
  }

  function bootstrap() {
    window.addEventListener('yt-navigate-start', () => onRouteChange('yt-navigate-start'), true);
    window.addEventListener('yt-navigate-finish', () => onRouteChange('yt-navigate-finish'), true);
    window.addEventListener('yt-page-data-updated', () => onRouteChange('yt-page-data-updated'), true);
    window.addEventListener('popstate', () => onRouteChange('popstate'), true);

    log('Bootstrap start. path=', location.pathname);
    if (isShortsPage()) {
      currentShortsPath = location.pathname;
      startShortsObservers();
      bootPoll = setInterval(() => {
        setActiveVideoFromDOM('bootstrap');
      }, 300);
      setTimeout(() => {
        if (bootPoll) {
          clearInterval(bootPoll);
          bootPoll = null;
        }
      }, 5000);
    } else {
      stopShortsObservers();
    }
  }

  function onReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      fn();
    } else {
      window.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  }

  function fmtTime(t) {
    const n = Number(t) || 0;
    return n.toFixed(2) + 's';
  }

  try { bootstrap(); } catch (e) { log('Bootstrap error:', e); }
  onReady(() => {
    try { onRouteChange('dom-ready'); } catch (e) { log('dom-ready error:', e); }
  });
})();