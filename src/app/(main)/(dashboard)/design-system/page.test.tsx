import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
}))
vi.mock("@/components/design-system/showcase", () => ({ Showcase: () => null }))

import Page from "./page"

afterEach(() => vi.unstubAllEnvs())

describe("design-system showcase gate", () => {
  it("calls notFound() in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(() => Page()).toThrow("NEXT_NOT_FOUND")
  })
  it("renders outside production", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(() => Page()).not.toThrow()
  })
})
