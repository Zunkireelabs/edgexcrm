// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

import { EmailSenderCard } from "./email-sender-card";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STORED = {
  from_name: "Admizz Education",
  from_address: "hello@mail.admizz.com",
  reply_to: "hello@admizz.com",
  domain_verified: true,
  no_reply_address: "no-reply@mail.admizz.com",
  template_color: "#0D1282",
  template_accent: "#FDED22",
  updated_at: null,
};
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("EmailSenderCard: no-reply address and colours", () => {
  it("shows the stored no-reply address and both colours", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: STORED }));
    render(<EmailSenderCard />);
    expect(await screen.findByLabelText("No-reply address (optional)")).toHaveValue("no-reply@mail.admizz.com");
    expect(screen.getByLabelText("Layout colour")).toHaveValue("#0D1282");
    expect(screen.getByLabelText("Accent colour")).toHaveValue("#FDED22");
  });

  it("is empty for a company that has not set them up", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, no_reply_address: null, template_color: null, template_accent: null } }));
    render(<EmailSenderCard />);
    expect(await screen.findByLabelText("No-reply address (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Layout colour")).toHaveValue("");
  });

  it("Save sends all six fields, empty ones as null", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, no_reply_address: null, template_color: null, template_accent: null } }));
    render(<EmailSenderCard />);
    fireEvent.change(await screen.findByLabelText("No-reply address (optional)"), { target: { value: "no-reply@mail.admizz.com" } });
    fireEvent.change(screen.getByLabelText("Layout colour"), { target: { value: "#0D1282" } });
    fetchMock.mockResolvedValueOnce(json(200, { data: STORED }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/v1/settings/email-sender");
    expect(JSON.parse(init.body)).toEqual({
      from_name: "Admizz Education",
      from_address: "hello@mail.admizz.com",
      reply_to: "hello@admizz.com",
      no_reply_address: "no-reply@mail.admizz.com",
      template_color: "#0D1282",
      template_accent: null,
    });
  });

  it("shows the server's real reason when it refuses (for example a different domain), not a generic failure", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: STORED }));
    render(<EmailSenderCard />);
    await screen.findByLabelText("No-reply address (optional)");
    fetchMock.mockResolvedValueOnce(
      json(422, { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { no_reply_address: ["Must be on the same domain as the From address (@mail.admizz.com)"] } } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Must be on the same domain as the From address (@mail.admizz.com)"));
  });
});
