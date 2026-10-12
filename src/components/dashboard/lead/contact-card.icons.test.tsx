// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ContactCard } from "./contact-card";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

beforeAll(() => {
  // jsdom has no ResizeObserver (TruncatedText uses one).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// The email / phone / place lines each carry a small leading icon. Icons are decorative
// (aria-hidden); the place keeps an accessible label ("City", "Nationality") since the visible
// word was replaced by the icon.

function lead(over: Record<string, unknown> = {}) {
  return {
    id: "l-1",
    tenant_id: "t-1",
    first_name: "Abdul",
    last_name: "Rahim",
    email: "abdul@example.com",
    phone: "+977-9040636618",
    city: "Chapagun",
    nationality: null,
    tags: [],
    custom_fields: {},
    created_at: "2026-10-12T07:41:00Z",
    updated_at: "2026-10-12T08:00:00Z",
    ...over,
  };
}

afterEach(() => {
  cleanup();
  toastSuccess.mockClear();
});

describe("ContactCard contact-line icons", () => {
  it("shows a mail icon, a phone icon and a pin for the city", () => {
    const { container } = render(<ContactCard lead={lead() as never} />);
    expect(container.querySelector("svg.lucide-mail")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-phone")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-map-pin")).toBeInTheDocument();
  });

  describe("click to copy", () => {
    function stubClipboard() {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      return writeText;
    }

    it("copies the email and shows 'Email copied' — it is a button, not a mailto link", async () => {
      const writeText = stubClipboard();
      render(<ContactCard lead={lead() as never} />);
      const el = screen.getByText("abdul@example.com").closest("button");
      expect(el).not.toBeNull();
      expect(screen.getByText("abdul@example.com").closest("a")).toBeNull();
      fireEvent.click(el!);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("abdul@example.com"));
      expect(toastSuccess).toHaveBeenCalledWith("Email copied");
    });

    it("copies the phone and shows 'Phone copied' — it is a button, not a tel link", async () => {
      const writeText = stubClipboard();
      render(<ContactCard lead={lead() as never} />);
      const el = screen.getByText("+977-9040636618").closest("button");
      expect(el).not.toBeNull();
      expect(screen.getByText("+977-9040636618").closest("a")).toBeNull();
      fireEvent.click(el!);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("+977-9040636618"));
      expect(toastSuccess).toHaveBeenCalledWith("Phone copied");
    });

    it("leaves the bottom Email and Call buttons as they were", () => {
      render(<ContactCard lead={lead() as never} />);
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Call")).toBeInTheDocument();
    });
  });

  it("labels the place for screen readers instead of the visible 'City:' word", () => {
    render(<ContactCard lead={lead() as never} />);
    expect(screen.getByTitle("City")).toBeInTheDocument();
    expect(screen.getByText("City:", { exact: false })).toHaveClass("sr-only");
  });

  it("uses a globe for nationality", () => {
    const { container } = render(<ContactCard lead={lead({ nationality: "Nepal" }) as never} />);
    expect(screen.getByTitle("Nationality")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-globe")).toBeInTheDocument();
  });

  it("omits icons for lines the lead does not have", () => {
    const { container } = render(<ContactCard lead={lead({ email: null, phone: null, city: null }) as never} />);
    expect(container.querySelector("svg.lucide-mail")).toBeInTheDocument(); // the Email action button
    expect(screen.queryByText("abdul@example.com")).not.toBeInTheDocument();
    expect(screen.queryByTitle("City")).not.toBeInTheDocument();
  });
});
