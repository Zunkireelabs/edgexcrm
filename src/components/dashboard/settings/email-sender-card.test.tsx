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
  template_logo_url: "https://edgex.zunkireelabs.com/email/admizz-logo.png",
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
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, no_reply_address: null, template_color: null, template_accent: null, template_logo_url: null } }));
    render(<EmailSenderCard />);
    expect(await screen.findByLabelText("No-reply address (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Layout colour")).toHaveValue("");
  });

  it("Save sends all seven fields, empty ones as null", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, no_reply_address: null, template_color: null, template_accent: null, template_logo_url: null } }));
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
      template_logo_url: null,
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

  it("says the no-reply address is not active yet while the company address is not verified", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, domain_verified: false } }));
    render(<EmailSenderCard />);
    await screen.findByLabelText("No-reply address (optional)");
    expect(screen.getByRole("status")).toHaveTextContent("Not active yet");
  });

  it("does not say that when the company address is verified, or when there is no no-reply address", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: STORED }));
    const { unmount } = render(<EmailSenderCard />);
    await screen.findByLabelText("No-reply address (optional)");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, domain_verified: false, no_reply_address: null } }));
    render(<EmailSenderCard />);
    await screen.findByLabelText("No-reply address (optional)");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the stored logo link with a small preview, and sends a changed link on Save", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: STORED }));
    render(<EmailSenderCard />);
    const input = await screen.findByLabelText("Logo link (https)");
    expect(input).toHaveValue("https://edgex.zunkireelabs.com/email/admizz-logo.png");
    expect(screen.getByAltText("Logo preview")).toHaveAttribute("src", "https://edgex.zunkireelabs.com/email/admizz-logo.png");
    fireEvent.change(input, { target: { value: "https://cdn.example.com/new.png" } });
    fetchMock.mockResolvedValueOnce(json(200, { data: STORED }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).template_logo_url).toBe("https://cdn.example.com/new.png");
  });

  it("shows no preview for an empty or non-https link", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ...STORED, template_logo_url: null } }));
    render(<EmailSenderCard />);
    const input = await screen.findByLabelText("Logo link (https)");
    expect(screen.queryByAltText("Logo preview")).toBeNull();
    fireEvent.change(input, { target: { value: "http://insecure.example.com/a.png" } });
    expect(screen.queryByAltText("Logo preview")).toBeNull();
  });
});
