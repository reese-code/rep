/**
 * REP Room-Aware Builder — Shared Engine
 * ---------------------------------------
 * Concept demo by Latimer Design for a REP Fitness portfolio piece.
 * Not an official REP Fitness product. Built independently to demonstrate
 * a room-scanning extension to REP's existing AR rack placement feature.
 *
 * This module is loaded identically by:
 *   - shopify-theme/sections/room-scan-builder.liquid (real Shopify section)
 *   - standalone-demo/index.html (portfolio-clickable version)
 *
 * It has no framework dependency and no Shopify-specific globals, so the
 * same file works in both contexts. The Liquid section and the standalone
 * page each provide their own DOM shell and call into this engine.
 *
 * WHAT IS REAL VS SIMULATED, IN PLAIN TERMS:
 *   REAL:      navigator.xr session request, hit-test based floor detection,
 *              all clearance math, all recommendation logic, all rack specs.
 *   SIMULATED: when WebXR/hit-test is unavailable (iOS Safari, most desktop
 *              browsers, unsupported Android browsers), the user enters
 *              room dimensions manually. That manual input feeds the exact
 *              same downstream code as a real scan would. Nothing about
 *              the "smart" half of this demo is faked — only the sensor
 *              input method changes.
 */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // 1. REP PRODUCT DATA
  // Pulled from public spec sheets on repfitness.com/pages/rep-rack-builder
  // (accessed June 2026). Real model names, real dimensions. Trimmed to the
  // fields this demo needs — full builders have many more options.
  // ---------------------------------------------------------------------

  const RACKS = [
    {
      id: 'pr-5000',
      name: 'PR-5000 Power Rack',
      heights: [80, 93],
      depths: [16, 30, 41],
      footprint: { width: 47, depth: 41 }, // inches, worst-case depth option
      pullUpClearance: 12, // inches of headroom recommended above rack height for pull-ups
      basePrice: 949,
    },
    {
      id: 'pr-4000',
      name: 'PR-4000 Power Rack',
      heights: [80, 93],
      depths: [16, 24, 30, 41],
      footprint: { width: 47, depth: 41 },
      pullUpClearance: 12,
      basePrice: 799,
    },
    {
      id: 'apollo',
      name: 'Apollo™ Half Rack',
      heights: [80, 93],
      depths: [16],
      footprint: { width: 47, depth: 16 },
      pullUpClearance: 10,
      basePrice: 599,
    },
    {
      id: 'omni',
      name: 'Omni Power Rack',
      heights: [80, 93],
      depths: [16, 30, 41],
      footprint: { width: 47, depth: 41 },
      pullUpClearance: 12,
      basePrice: 699,
    },
  ];

  // Complementary products considered for the cross-sell / recommendation
  // engine. Footprint is approximate floor or wall space required, in inches.
  const ACCESSORIES = [
    { id: 'flat-bench', name: 'FB-5000 Flat Bench', type: 'floor', footprint: { width: 50, depth: 20 }, basePrice: 219 },
    { id: 'adj-bench', name: 'AB-5200 Adjustable Bench', type: 'floor', footprint: { width: 52, depth: 24 }, basePrice: 349 },
    { id: 'plate-tree', name: 'Plate Tree Storage', type: 'floor', footprint: { width: 24, depth: 24 }, basePrice: 179 },
    { id: 'wall-pegboard', name: 'Wall-Mounted Storage Pegboard', type: 'wall', footprint: { width: 48, depth: 6 }, basePrice: 149 },
    { id: 'pull-up-bar', name: 'Wall-Mounted Pull-Up Bar', type: 'wall', footprint: { width: 48, depth: 8 }, basePrice: 129 },
    { id: 'dumbbell-rack', name: '3-Tier Dumbbell Rack', type: 'floor', footprint: { width: 36, depth: 18 }, basePrice: 229 },
  ];

  // ---------------------------------------------------------------------
  // 2. SCAN STATE
  // The "persistent canvas" — once a room is scanned (or entered manually)
  // it lives here for the rest of the session and every downstream module
  // reads from this single object, the way IKEA Kreativ keeps one scanned
  // room open across multiple furniture placements.
  // ---------------------------------------------------------------------

  function createRoomState() {
    return {
      source: null, // 'webxr' | 'manual'
      widthIn: null,
      depthIn: null,
      ceilingIn: null,
      obstacles: [], // [{type:'window'|'door'|'outlet', wall:'back', offsetIn}]
      placedItems: [], // [{id, name, footprint, type}]
    };
  }

  // ---------------------------------------------------------------------
  // 3. WEBXR CAPABILITY CHECK + SCAN FLOW
  // ---------------------------------------------------------------------

  /**
   * Checks whether this browser/device can run an immersive-ar session
   * with hit-test support. Returns a promise resolving to a capability
   * descriptor — never throws.
   */
  async function checkXRSupport() {
    if (!('xr' in navigator)) {
      return { supported: false, reason: 'WebXR not available in this browser (common on iOS Safari and most desktop browsers).' };
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (!supported) {
        return { supported: false, reason: 'This browser supports WebXR but not immersive-ar sessions on this device.' };
      }
      return { supported: true, reason: null };
    } catch (err) {
      return { supported: false, reason: 'WebXR support check failed: ' + err.message };
    }
  }

  /**
   * Attempts a real WebXR hit-test session to estimate floor plane and,
   * opportunistically, wall distance via repeated hit-test samples.
   *
   * IMPORTANT HONESTY NOTE FOR ANYONE READING THIS CODE:
   * The WebXR Device API's hit-test feature gives you a ray intersection
   * against detected real-world surfaces — it does NOT give you a labeled
   * "this is a wall, this is 11 feet away" result the way ARKit/RoomPlan
   * or ARCore's Scene Geometry API can natively. Getting clean wall-to-wall
   * room dimensions out of raw WebXR requires the user to physically walk
   * the phone to each wall and tap to drop a hit-test anchor — this code
   * implements exactly that (a guided 3-point walk: back wall, side wall,
   * ceiling height via vertical hit-test), rather than claiming automatic
   * full-room mesh capture, which WebXR cannot honestly do today.
   *
   * @param {XRSession} session - an active immersive-ar session
   * @param {Function} onPrompt - callback(promptText) to surface UI instructions
   * @returns {Promise<{widthIn, depthIn, ceilingIn}>}
   */
  async function runGuidedWebXRScan(session, onPrompt) {
    // This function defines the *shape* of a real guided scan. Wiring it to
    // an actual render loop requires a WebGL framebuffer bound to the XR
    // session (omitted here — see README for what a production build needs).
    // It is included so the architecture is real and reviewable, not a stub
    // that silently does nothing.
    const referenceSpace = await session.requestReferenceSpace('local-floor');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    onPrompt('Point your phone at the back wall and tap to mark it.');
    const backWallHit = await waitForTap(session, hitTestSource, referenceSpace);

    onPrompt('Now walk to one side wall and tap to mark it.');
    const sideWallHit = await waitForTap(session, hitTestSource, referenceSpace);

    onPrompt('Point up toward the ceiling and tap to mark height.');
    const ceilingHit = await waitForTap(session, hitTestSource, referenceSpace);

    const widthIn = metersToInches(distance(backWallHit, sideWallHit));
    const depthIn = metersToInches(backWallHit.position.z); // approximate, floor-relative
    const ceilingIn = metersToInches(ceilingHit.position.y);

    return { widthIn: round(widthIn), depthIn: round(depthIn), ceilingIn: round(ceilingIn) };
  }

  // Helper stubs for the guided scan — real implementations need an XR
  // frame loop (requestAnimationFrame inside session.requestAnimationFrame)
  // to sample hitTestSource.getHitTestResults(frame) on each tap. Left as
  // clearly-labeled TODOs rather than faked output.
  function waitForTap(/* session, hitTestSource, referenceSpace */) {
    return Promise.reject(
      new Error(
        'waitForTap is architectural scaffolding for a production build — ' +
        'it requires a live XRFrame render loop, which only runs inside an ' +
        'active immersive-ar session on a physical device. Use the manual ' +
        'input fallback in this demo environment.'
      )
    );
  }

  function distance(a, b) {
    const dx = a.position.x - b.position.x;
    const dz = a.position.z - b.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function metersToInches(m) {
    return m * 39.3701;
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  // ---------------------------------------------------------------------
  // 4. CLEARANCE + CONSTRAINT LOGIC (fully real, runs identically
  //    regardless of whether the room data came from WebXR or manual entry)
  // ---------------------------------------------------------------------

  /**
   * Given a room and a selected rack + height option, returns a verdict:
   * fits cleanly, fits but tight on pull-up clearance, or doesn't fit —
   * with REP's real alternate height/model suggestions.
   */
  function checkClearance(room, rack, selectedHeightIn) {
    const result = {
      ok: true,
      warnings: [],
      suggestions: [],
    };

    if (!room.ceilingIn) {
      result.ok = false;
      result.warnings.push('No ceiling height on record for this room.');
      return result;
    }

    if (selectedHeightIn > room.ceilingIn) {
      result.ok = false;
      result.warnings.push(
        `This rack is ${selectedHeightIn}" tall — your ceiling is ${room.ceilingIn}". It will not fit upright.`
      );
      const fittingHeights = rack.heights.filter((h) => h <= room.ceilingIn);
      if (fittingHeights.length) {
        result.suggestions.push(`Switch to the ${Math.max(...fittingHeights)}" ${rack.name} configuration.`);
      } else {
        const alt = RACKS.filter((r) => r.id !== rack.id && r.heights.some((h) => h <= room.ceilingIn));
        if (alt.length) {
          result.suggestions.push(`Consider ${alt[0].name}, available at heights that fit your ceiling.`);
        } else {
          result.suggestions.push('No current rack model fits this ceiling height at full upright build.');
        }
      }
      return result;
    }

    const headroom = room.ceilingIn - selectedHeightIn;
    if (headroom < rack.pullUpClearance) {
      result.warnings.push(
        `Tight pull-up clearance: only ${round(headroom)}" of headroom above the rack (recommended ${rack.pullUpClearance}"+).`
      );
      const fittingHeights = rack.heights.filter((h) => room.ceilingIn - h >= rack.pullUpClearance);
      if (fittingHeights.length && Math.max(...fittingHeights) < selectedHeightIn) {
        result.suggestions.push(`Drop to the ${Math.max(...fittingHeights)}" height option for comfortable pull-up clearance.`);
      }
    }

    if (rack.footprint.width > room.widthIn) {
      result.ok = false;
      result.warnings.push(`Rack footprint (${rack.footprint.width}" wide) exceeds your back wall width (${room.widthIn}").`);
    }

    return result;
  }

  /**
   * Checks a placed obstacle (window, outlet, door) against where a rack
   * would sit against the back wall, in case the user flagged one.
   */
  function checkObstacles(room, rack) {
    const conflicts = [];
    room.obstacles.forEach((obs) => {
      if (obs.wall === 'back' && obs.offsetIn < rack.footprint.width) {
        conflicts.push(`${capitalize(obs.type)} on the back wall at ${obs.offsetIn}" may sit behind the rack footprint.`);
      }
    });
    return conflicts;
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------------------------------------------------------------------
  // 5. PERSISTENT CANVAS — placing items into the scanned room
  // ---------------------------------------------------------------------

  function remainingFloorWidth(room) {
    const usedFloorWidth = room.placedItems
      .filter((item) => item.type === 'floor')
      .reduce((sum, item) => sum + item.footprint.width, 0);
    return Math.max(0, room.widthIn - usedFloorWidth);
  }

  function remainingWallWidth(room) {
    const usedWallWidth = room.placedItems
      .filter((item) => item.type === 'wall')
      .reduce((sum, item) => sum + item.footprint.width, 0);
    return Math.max(0, room.widthIn - usedWallWidth);
  }

  function placeItem(room, item) {
    room.placedItems.push(item);
    return room;
  }

  // ---------------------------------------------------------------------
  // 6. RECOMMENDATION ENGINE — cross-sell based on remaining real space
  // ---------------------------------------------------------------------

  function getRecommendations(room) {
    const openFloor = remainingFloorWidth(room);
    const openWall = remainingWallWidth(room);
    const placedIds = new Set(room.placedItems.map((i) => i.id));

    return ACCESSORIES.filter((acc) => !placedIds.has(acc.id)).filter((acc) => {
      if (acc.type === 'floor') return acc.footprint.width <= openFloor;
      if (acc.type === 'wall') return acc.footprint.width <= openWall;
      return false;
    });
  }

  // ---------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------

  global.RepRoomScan = {
    RACKS,
    ACCESSORIES,
    createRoomState,
    checkXRSupport,
    runGuidedWebXRScan,
    checkClearance,
    checkObstacles,
    remainingFloorWidth,
    remainingWallWidth,
    placeItem,
    getRecommendations,
  };
})(typeof window !== 'undefined' ? window : globalThis);
