// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastInfo, toastError } = vi.hoisted(() => ({ toastInfo: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: toastInfo, error: toastError, success: vi.fn() } }));
vi.mock("@/app/(widget)/consent/[token]/consent-sign-form", () => ({ ConsentSignForm: () => null }));

import { InPersonConsentDialog } from "./in-person-consent-dialog";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastInfo.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderOpen(onOpenChange: (open: boolean) => void) {
  render(<InPersonConsentDialog open onOpenChange={onOpenChange} leadId="lead-1" onSuccess={() => {}} />);
}

describe("InPersonConsentDialog — start session", () => {
  it("409 (already signed, stale card): says so and closes, instead of the generic failure", async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: { code: "ALREADY_SIGNED" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    renderOpen(onOpenChange);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastInfo).toHaveBeenCalledWith("Consent is already signed for this lead");
    expect(toastError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // never goes on to fetch a signing token
  });

  it("any other failure still shows the generic error and closes", async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    renderOpen(onOpenChange);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastError).toHaveBeenCalledWith("Failed to start signing session");
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
