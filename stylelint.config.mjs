// Spacing values that have a token must use it. The rule is scoped to the stylesheets that have been
// tokenised; presence.css and the public pages keep their own responsive scale for now.
const tokenisedStylesheets = [
  "web/style.css",
  "web/planner.css",
  "web/dashboard.css",
  "web/tools.css",
  "web/history.css",
  "web/admin.css",
  "web/energy.css",
];

export default {
  rules: {
    "color-no-invalid-hex": true,
  },
  overrides: [
    {
      files: tokenisedStylesheets,
      rules: {
        "declaration-property-value-disallowed-list": {
          "/^(padding|margin|gap|row-gap|column-gap)(-.*)?$/": [
            "/(?:^|[\\s(])(?:2|4|6|8|10|12|14|16|18|20|22|24|28|32|36|40|44|48|80)px(?=$|[\\s)])/",
          ],
        },
      },
    },
  ],
};
