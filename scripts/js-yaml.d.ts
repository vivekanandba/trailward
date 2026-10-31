// The one function scripts/workflows.test.ts uses; js-yaml ships no types.
declare module "js-yaml" {
  export function load(text: string): unknown;
}
