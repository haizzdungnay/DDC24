import { describe, expect, it } from 'vitest'
import {
  clampScale,
  graphToScreen,
  nextViewport,
  screenToGraph,
  snapPoint,
  type FbdViewport,
  type ViewportRect,
} from './viewport'

describe('viewport math', () => {
  const defaultSceneRect: ViewportRect = {
    left: 100,
    top: 50,
    width: 800,
    height: 600,
  }

  describe('clampScale', () => {
    it('clamps scale within default boundaries [0.4, 2.5]', () => {
      expect(clampScale(0.1)).toBe(0.4)
      expect(clampScale(0.4)).toBe(0.4)
      expect(clampScale(1.0)).toBe(1.0)
      expect(clampScale(2.5)).toBe(2.5)
      expect(clampScale(3.0)).toBe(2.5)
    })

    it('clamps scale within custom boundaries', () => {
      expect(clampScale(0.2, 0.5, 2.0)).toBe(0.5)
      expect(clampScale(2.2, 0.5, 2.0)).toBe(2.0)
      expect(clampScale(1.5, 0.5, 2.0)).toBe(1.5)
    })

    it('falls back to 1 if scale is NaN or Infinite', () => {
      expect(clampScale(Number.NaN)).toBe(1)
      expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1)
      expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(1)
    })
  })

  describe('screenToGraph and graphToScreen roundtrip', () => {
    it('correctly maps 1:1 scale with zero viewport offset', () => {
      const viewport: FbdViewport = { x: 0, y: 0, scale: 1 }
      const screenPoint = { x: 250, y: 150 }

      const graph = screenToGraph(screenPoint, viewport, defaultSceneRect)
      expect(graph).toEqual({ x: 150, y: 100 })

      const backToScreen = graphToScreen(graph, viewport, defaultSceneRect)
      expect(backToScreen).toEqual(screenPoint)
    })

    it('correctly maps with pan offset and scaled viewport', () => {
      const viewport: FbdViewport = { x: 50, y: 30, scale: 2 }
      const screenPoint = { x: 350, y: 280 }

      // graphX = (350 - 100 - 50) / 2 = 100
      // graphY = (280 - 50 - 30) / 2 = 100
      const graph = screenToGraph(screenPoint, viewport, defaultSceneRect)
      expect(graph).toEqual({ x: 100, y: 100 })

      // screenX = 100 + 50 + 100 * 2 = 350
      // screenY = 50 + 30 + 100 * 2 = 280
      const backToScreen = graphToScreen(graph, viewport, defaultSceneRect)
      expect(backToScreen).toEqual(screenPoint)
    })

    it('handles negative graph coordinates', () => {
      const viewport: FbdViewport = { x: 200, y: 200, scale: 0.5 }
      const graphPoint = { x: -40, y: -60 }

      const screen = graphToScreen(graphPoint, viewport, defaultSceneRect)
      // screenX = 100 + 200 + (-40) * 0.5 = 280
      // screenY = 50 + 200 + (-60) * 0.5 = 220
      expect(screen).toEqual({ x: 280, y: 220 })

      const backToGraph = screenToGraph(screen, viewport, defaultSceneRect)
      expect(backToGraph).toEqual(graphPoint)
    })
  })

  describe('snapPoint', () => {
    it('snaps coordinates to nearest snapSize', () => {
      expect(snapPoint({ x: 14, y: 19 }, 8)).toEqual({ x: 16, y: 16 })
      expect(snapPoint({ x: 12, y: 20 }, 8)).toEqual({ x: 16, y: 24 })
      expect(snapPoint({ x: 7, y: 3 }, 16)).toEqual({ x: 0, y: 0 })
      expect(snapPoint({ x: 9, y: 25 }, 16)).toEqual({ x: 16, y: 32 })
    })

    it('bypasses snap when bypassAlt is true', () => {
      const point = { x: 14.5, y: 19.2 }
      expect(snapPoint(point, 8, true)).toEqual(point)
    })

    it('bypasses snap when snapSize <= 0', () => {
      const point = { x: 14.5, y: 19.2 }
      expect(snapPoint(point, 0)).toEqual(point)
      expect(snapPoint(point, -8)).toEqual(point)
    })
  })

  describe('nextViewport', () => {
    it('returns a new immutable viewport with clamped scale', () => {
      const current: FbdViewport = { x: 10, y: 20, scale: 1 }
      const next = nextViewport(current, { scale: 5 })

      expect(next).toEqual({ x: 10, y: 20, scale: 2.5 })
      expect(next).not.toBe(current)
    })

    it('updates position while preserving scale', () => {
      const current: FbdViewport = { x: 10, y: 20, scale: 1.5 }
      const next = nextViewport(current, { x: 100, y: 200 })

      expect(next).toEqual({ x: 100, y: 200, scale: 1.5 })
    })

    it('sanitizes NaN and Infinity in updates', () => {
      const current: FbdViewport = { x: 10, y: 20, scale: 1.5 }
      const next = nextViewport(current, {
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        scale: Number.NaN,
      })

      expect(next).toEqual({ x: 10, y: 20, scale: 1.5 })
    })
  })
})
