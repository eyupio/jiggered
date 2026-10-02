// Current location is explicit: a date format or browser language is not a location.
// Official references: gov.uk/guidance/999-and-112-the-uks-national-emergency-numbers;
// 911.gov/calling-911/; canada.ca/en/public-health/services/mental-health-services/mental-health-get-help.html;
// digital-strategy.ec.europa.eu/en/policies/112; acma.gov.au/emergency-calls;
// police.govt.nz/call-111. Unknown regions stay generic rather than guessing a number.
export const REGIONS = [
  ["", "Choose your current region", ""],
  ["GB", "United Kingdom", "999 or 112"],
  ["US", "United States", "911"],
  ["CA", "Canada", "911"],
  ["EU", "European Union", "112"],
  ["AU", "Australia", "000"],
  ["NZ", "New Zealand", "111"],
  ["other", "Another country or region", ""],
];
export const normaliseRegion = (value) => (REGIONS.some(([id]) => id === value) ? value : "");
export function emergencyCall(region) {
  const number = REGIONS.find(([id]) => id === normaliseRegion(region))[2];
  return number ? `Call ${number}` : "Call your local emergency number";
}
export function applyRegion(region, root = document) {
  for (const el of root.querySelectorAll("[data-emergency-call]"))
    el.textContent = emergencyCall(region);
}
