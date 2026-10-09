// @vitest-environment jsdom
//
// Client request (Student Details): structured Nepal address (Country > Province > District >
// Municipality > Ward > Tole), one plain box for other countries, no Emergency Contact.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { EMPTY_ADDRESS, formatAddress } from "@/lib/leads/address";
import { AddressFields } from "./address-fields";
import { qualificationsFromLead } from "./qualifications-section";
import {
  PersonalDetailsDialog,
  PERSONAL_DETAIL_FIELDS,
  addressPartsOf,
  buildLivePatch,
  coreIdentityFromLead,
  leadSourceFromLead,
  personalDetailsFromLead,
  studyInterestFromLead,
} from "./personal-details-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(cleanup);

const noop = () => {};
const nepal = { ...EMPTY_ADDRESS, country: "Nepal" };

function triggerFor(label: string): HTMLElement {
  const labelEl = screen.getByText(label, { exact: true });
  // each EditableField is <div><p label/><Select trigger/></div>
  return labelEl.parentElement!.querySelector('[role="combobox"]') as HTMLElement;
}

describe("AddressFields (editing)", () => {
  it("shows the full Nepal hierarchy, in order", () => {
    render(<AddressFields isEditing parts={nepal} fullAddress="" onPartChange={noop} onFullAddressChange={noop} />);
    const labels = ["Country", "Province", "District", "Municipality / Rural Municipality", "Ward", "Tole / Street"];
    // Text inputs also carry a screen-reader-only label with the same text, so take the first match.
    const order = labels.map((l) => screen.getAllByText(l, { exact: true })[0]);
    for (const el of order) expect(el).toBeInTheDocument();
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("keeps District, Municipality and Ward disabled until their parent is chosen", () => {
    render(<AddressFields isEditing parts={nepal} fullAddress="" onPartChange={noop} onFullAddressChange={noop} />);
    expect(triggerFor("Province")).not.toBeDisabled();
    expect(triggerFor("District")).toBeDisabled();
    expect(triggerFor("Municipality / Rural Municipality")).toBeDisabled();
    expect(triggerFor("Ward")).toBeDisabled();
  });

  it("enables each level once the one above it has a value", () => {
    render(
      <AddressFields
        isEditing
        parts={{ ...nepal, province: "Bagmati", district: "Kathmandu", municipality: "Kathmandu Metropolitan City" }}
        fullAddress=""
        onPartChange={noop}
        onFullAddressChange={noop}
      />,
    );
    expect(triggerFor("District")).not.toBeDisabled();
    expect(triggerFor("Municipality / Rural Municipality")).not.toBeDisabled();
    expect(triggerFor("Ward")).not.toBeDisabled();
  });

  it("shows one plain Address box for other countries, with no Nepal fields", () => {
    render(
      <AddressFields isEditing parts={{ ...EMPTY_ADDRESS, country: "India" }} fullAddress="12 MG Road" onPartChange={noop} onFullAddressChange={noop} />,
    );
    expect(screen.getByDisplayValue("12 MG Road")).toBeInTheDocument();
    for (const l of ["Province", "District", "Ward", "Tole / Street"]) expect(screen.queryByText(l, { exact: true })).toBeNull();
  });

  it("shows the address on file when a Nepal student only has old typed text", () => {
    render(<AddressFields isEditing parts={nepal} fullAddress="Near the temple, Birgunj" onPartChange={noop} onFullAddressChange={noop} />);
    expect(screen.getByText(/Near the temple, Birgunj/)).toBeInTheDocument();
  });
});

describe("AddressFields (read-only)", () => {
  it("shows Country and the readable address", () => {
    const parts = { country: "Nepal", province: "Bagmati", district: "Kathmandu", municipality: "Kathmandu Metropolitan City", ward: "5", tole: "Baneshwor" };
    render(<AddressFields isEditing={false} parts={parts} fullAddress={formatAddress(parts)} onPartChange={noop} onFullAddressChange={noop} />);
    expect(screen.getByText("Nepal", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Baneshwor, Ward 5, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal")).toBeInTheDocument();
  });
});

describe("Student Details dialog", () => {
  it("no longer lists Emergency Contact or a Full Address field in Basic Details", () => {
    const keys = PERSONAL_DETAIL_FIELDS.map((f) => f.key) as string[];
    expect(keys).toEqual(["date_of_birth", "marital_status", "father_name", "mother_name"]);
  });

  it("renders the Address section and no Emergency Contact when editing", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) })) as unknown as typeof fetch;
    render(
      <PersonalDetailsDialog
        lead={{ id: "l1", country: "Nepal", custom_fields: {}, destinations: [] } as unknown as Lead}
        open
        onOpenChange={noop}
        openInEditMode
      />,
    );
    expect((await screen.findAllByText("Province", { exact: true })).length).toBeGreaterThan(0);
    expect(screen.queryByText("Emergency Contact Name", { exact: true })).toBeNull();
    expect(screen.queryByText("Emergency Contact No.", { exact: true })).toBeNull();
    // Guardian Details stay.
    expect(screen.getAllByText("Guardian Phone", { exact: true }).length).toBeGreaterThan(0);
  });
});

describe("saving the address", () => {
  const lead = { id: "l1", custom_fields: {}, destinations: [], country: "Nepal", city: "Kathmandu" } as unknown as Lead;
  const study = studyInterestFromLead(lead);
  const source = leadSourceFromLead(lead);

  it("sends the parts, the composed full address, and country — and nothing untouched", () => {
    const core = coreIdentityFromLead(lead);
    const original = personalDetailsFromLead(lead);
    const parts = { country: "Nepal", province: "Bagmati", district: "Kathmandu", municipality: "Kathmandu Metropolitan City", ward: "5", tole: "Baneshwor" };
    const draft = {
      ...original,
      address_province: parts.province,
      address_district: parts.district,
      address_municipality: parts.municipality,
      address_ward: parts.ward,
      address_tole: parts.tole,
      full_address: formatAddress(parts),
    };
    const quals = qualificationsFromLead(lead);
    const patch = buildLivePatch(core, core, study, study, quals, quals, [], [], null, source, draft, original);
    expect(patch).toEqual({
      address_province: "Bagmati",
      address_district: "Kathmandu",
      address_municipality: "Kathmandu Metropolitan City",
      address_ward: "5",
      address_tole: "Baneshwor",
      full_address: "Baneshwor, Ward 5, Kathmandu Metropolitan City, Kathmandu, Bagmati, Nepal",
    });
    expect(addressPartsOf(core, draft).country).toBe("Nepal");
  });
});
