import { describe, expect, it } from "vitest";
import { attributeProviderResults } from "./attribute";
import type { SmsSendResult } from "./provider/types";

function result(valid: SmsSendResult["valid"], invalid: SmsSendResult["invalid"] = []): SmsSendResult {
  return { valid, invalid };
}

describe("attributeProviderResults", () => {
  it("attributes 3 valid recipients to their own provider ids", () => {
    const messages = [
      { id: "m1", to_phone: "9800000001" },
      { id: "m2", to_phone: "9800000002" },
      { id: "m3", to_phone: "9800000003" },
    ];
    const providerResult = result([
      { id: "p1", mobile: "9800000001", credit: 1, network: "ntc", status: "queued" },
      { id: "p2", mobile: "9800000002", credit: 1, network: "ncell", status: "queued" },
      { id: "p3", mobile: "9800000003", credit: 1, network: "ntc", status: "queued" },
    ]);

    const { attributions, totalCreditsCharged, unmatched } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: false,
    });

    expect(unmatched).toEqual([]);
    expect(attributions).toEqual([
      { messageId: "m1", outcome: "submitted", providerMessageId: "p1", credit: 1, network: "ntc", providerStatus: "queued", shortcode: null },
      { messageId: "m2", outcome: "submitted", providerMessageId: "p2", credit: 1, network: "ncell", providerStatus: "queued", shortcode: null },
      { messageId: "m3", outcome: "submitted", providerMessageId: "p3", credit: 1, network: "ntc", providerStatus: "queued", shortcode: null },
    ]);
    expect(totalCreditsCharged).toBe(3);
  });

  it("does not shift downstream recipients when the middle recipient is invalid", () => {
    const messages = [
      { id: "m1", to_phone: "9800000001" },
      { id: "m2", to_phone: "9800000002" },
      { id: "m3", to_phone: "9800000003" },
    ];
    const providerResult = result(
      [
        { id: "p1", mobile: "9800000001", credit: 1, network: "ntc", status: "queued" },
        { id: "p3", mobile: "9800000003", credit: 1, network: "ntc", status: "queued" },
      ],
      [{ mobile: "9800000002", message: "aborted" }]
    );

    const { attributions, totalCreditsCharged, unmatched } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: false,
    });

    expect(unmatched).toEqual([]);
    const m1 = attributions.find((a) => a.messageId === "m1");
    const m2 = attributions.find((a) => a.messageId === "m2");
    const m3 = attributions.find((a) => a.messageId === "m3");

    expect(m1).toEqual({
      messageId: "m1",
      outcome: "submitted",
      providerMessageId: "p1",
      credit: 1,
      network: "ntc",
      providerStatus: "queued",
      shortcode: null,
    });
    expect(m3).toEqual({
      messageId: "m3",
      outcome: "submitted",
      providerMessageId: "p3",
      credit: 1,
      network: "ntc",
      providerStatus: "queued",
      shortcode: null,
    });
    expect(m2).toEqual({
      messageId: "m2",
      outcome: "failed",
      errorCode: "provider_rejected",
      errorMessage: "aborted",
    });

    expect(totalCreditsCharged).toBe(2);
  });

  it("does not duplicate a provider id when the last recipient is invalid", () => {
    const messages = [
      { id: "m1", to_phone: "9800000001" },
      { id: "m2", to_phone: "9800000002" },
      { id: "m3", to_phone: "9800000003" },
    ];
    const providerResult = result(
      [
        { id: "p1", mobile: "9800000001", credit: 1, network: "ntc", status: "queued" },
        { id: "p2", mobile: "9800000002", credit: 1, network: "ntc", status: "queued" },
      ],
      [{ mobile: "9800000003", message: "aborted" }]
    );

    const { attributions } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: false,
    });

    const submittedIds = attributions
      .filter((a) => a.outcome === "submitted")
      .map((a) => (a as Extract<typeof a, { outcome: "submitted" }>).providerMessageId);

    expect(new Set(submittedIds).size).toBe(submittedIds.length);
    expect(attributions.find((a) => a.messageId === "m3")).toEqual({
      messageId: "m3",
      outcome: "failed",
      errorCode: "provider_rejected",
      errorMessage: "aborted",
    });
  });

  it("marks a recipient in neither array as failed with no_provider_result and lists it as unmatched", () => {
    const messages = [{ id: "m1", to_phone: "9800000001" }];
    const providerResult = result([], []);

    const { attributions, unmatched } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: false,
    });

    expect(attributions).toEqual([
      {
        messageId: "m1",
        outcome: "failed",
        errorCode: "no_provider_result",
        errorMessage: "Recipient found in neither the provider's valid nor invalid results.",
      },
    ]);
    expect(unmatched).toEqual(["m1"]);
  });

  it("attributes two message rows sharing one phone number and counts the credit once", () => {
    const messages = [
      { id: "m1", to_phone: "9800000001" },
      { id: "m2", to_phone: "9800000001" },
    ];
    const providerResult = result([{ id: "p1", mobile: "9800000001", credit: 5, network: "ntc", status: "queued" }]);

    const { attributions, totalCreditsCharged } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: false,
    });

    expect(attributions).toEqual([
      { messageId: "m1", outcome: "submitted", providerMessageId: "p1", credit: 5, network: "ntc", providerStatus: "queued", shortcode: null },
      { messageId: "m2", outcome: "submitted", providerMessageId: "p1", credit: 5, network: "ntc", providerStatus: "queued", shortcode: null },
    ]);
    expect(totalCreditsCharged).toBe(5);
  });

  it("matches despite phone format drift (dial code prefix, whitespace)", () => {
    const messages = [
      { id: "m1", to_phone: "9800000001" },
      { id: "m2", to_phone: "9800000002" },
    ];
    const providerResult = result([
      { id: "p1", mobile: "977-9800000001", credit: 1, network: "ntc", status: "queued" },
      { id: "p2", mobile: " 9800000002", credit: 1, network: "ntc", status: "queued" },
    ]);

    const { attributions, unmatched } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: false,
    });

    expect(unmatched).toEqual([]);
    expect(attributions.every((a) => a.outcome === "submitted")).toBe(true);
  });

  it("keeps positional behaviour for sandboxed sends without throwing when messages outnumber results", () => {
    const messages = [
      { id: "m1", to_phone: "9800000001" },
      { id: "m2", to_phone: "9800000002" },
      { id: "m3", to_phone: "9800000003" },
    ];
    const providerResult = result([{ id: "p1", mobile: "9700000000", credit: 2, network: "ntc", status: "queued" }]);

    const { attributions, totalCreditsCharged } = attributeProviderResults({
      messages,
      result: providerResult,
      sandboxed: true,
    });

    expect(attributions).toHaveLength(3);
    expect(attributions.every((a) => a.outcome === "submitted")).toBe(true);
    expect(totalCreditsCharged).toBe(6);
  });
});
