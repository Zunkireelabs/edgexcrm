import { describe, expect, it } from "vitest";
import { channelOf, isOutreachChannel } from "./channel";
import { validateSequenceSteps, SMS_BODY_TEMPLATE_MAX } from "./validate-steps";

describe("outreach channel", () => {
  it("recognises only email and sms", () => {
    expect(isOutreachChannel("email")).toBe(true);
    expect(isOutreachChannel("sms")).toBe(true);
    expect(isOutreachChannel("whatsapp")).toBe(false);
    expect(isOutreachChannel(undefined)).toBe(false);
  });

  it("reads anything unknown (or a pre-migration row) as email", () => {
    expect(channelOf({ channel: "sms" })).toBe("sms");
    expect(channelOf({ channel: null })).toBe("email");
    expect(channelOf({})).toBe("email");
    expect(channelOf(null)).toBe("email");
  });
});

describe("validateSequenceSteps by channel", () => {
  const smsStep = { step_order: 1, delay_days: 0, subject_template: "", body_template: "Hi {{first_name|there}}" };

  it("accepts a plain SMS step", () => {
    expect(validateSequenceSteps([smsStep], "sms")).toBeNull();
  });

  it("rejects a subject on an SMS step", () => {
    expect(validateSequenceSteps([{ ...smsStep, subject_template: "Hello" }], "sms")).toBe("SMS steps have no subject");
  });

  it("rejects an SMS step with no message (it would go out as just the sender name and the opt-out link)", () => {
    expect(validateSequenceSteps([{ ...smsStep, body_template: "   " }], "sms")).toBe("Every SMS step needs a message");
    expect(validateSequenceSteps([{ step_order: 1, delay_days: 0 }], "sms")).toBe("Every SMS step needs a message");
  });

  it("rejects an over-long SMS body", () => {
    const long = { ...smsStep, body_template: "x".repeat(SMS_BODY_TEMPLATE_MAX + 1) };
    expect(validateSequenceSteps([long], "sms")).toContain("characters or fewer");
  });

  it("leaves email validation exactly as it was (subject allowed, default channel)", () => {
    expect(validateSequenceSteps([{ ...smsStep, subject_template: "Hello" }])).toBeNull();
  });
});
