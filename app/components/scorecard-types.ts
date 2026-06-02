// Shared types + constants for the Leads drilldown surface.
// Imported by both /scorecard and /marketing pages so a single change
// propagates everywhere.

export interface LeadRecord {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  dateAdded: number;
  primaryPipelineId: string;
  primaryPipelineName: string;
  source: string;
}

// Mirror of ACTIVE_SELLER_PIPELINES in api/scorecard/builder.ts. Used to
// render pipeline chip labels in the Leads drilldown.
export const PIPELINE_NAMES: Record<string, string> = {
  "6tntgcGDlTyw30KUgRrS": "Leads",
  "nwSjS0rUTMGbgDvyrEe4": "Mike",
  "ggnBpwig6OE37fXPQv7a": "Josh",
  "jTIXfKdqlRKALGw8fj4e": "OfferFu",
  "ofMQolXiKGyg6WNOJS88": "TC",
  "DiGXnGTlQCOMZQJmWQe9": "Deals",
  "WLFdj0t3NfI17P0zuFsX": "Dead",
};

export const PIPELINE_ORDER = [
  "6tntgcGDlTyw30KUgRrS",
  "nwSjS0rUTMGbgDvyrEe4",
  "ggnBpwig6OE37fXPQv7a",
  "jTIXfKdqlRKALGw8fj4e",
  "ofMQolXiKGyg6WNOJS88",
  "DiGXnGTlQCOMZQJmWQe9",
  "WLFdj0t3NfI17P0zuFsX",
];

export const GHL_LOCATION_ID = "Js1OZngrzWeqSwiHjbRx";
