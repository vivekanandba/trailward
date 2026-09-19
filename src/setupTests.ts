import "@testing-library/jest-dom/vitest";

// jsdom implements no layout, so Element.scrollIntoView is absent. The app
// calls it to reveal the selected row (spec 33); stub it so component tests
// exercise that path instead of throwing.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
