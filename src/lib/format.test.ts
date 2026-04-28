import { describe, it, expect } from 'vitest'
import { formatPence } from './format'

describe('formatPence', () => {
  it('renders whole pounds with two decimals', () => {
    expect(formatPence(1000)).toBe('£10.00')
  })

  it('renders mixed pounds and pence', () => {
    expect(formatPence(1250)).toBe('£12.50')
  })

  it('renders zero', () => {
    expect(formatPence(0)).toBe('£0.00')
  })

  it('renders sub-pound values', () => {
    expect(formatPence(7)).toBe('£0.07')
  })

  it('renders negative values with a leading minus', () => {
    expect(formatPence(-500)).toBe('-£5.00')
  })

  it('throws on non-finite input', () => {
    expect(() => formatPence(Number.NaN)).toThrow(TypeError)
    expect(() => formatPence(Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })
})
