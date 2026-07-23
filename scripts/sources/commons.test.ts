import { describe, it, expect } from "vitest";
import { parseCommonsFiles, parseCommonsImages, parseCommonsImageInfo } from "./commons";

describe("parseCommonsFiles", () => {
  it("keeps File: titles from a geosearch response", () => {
    expect(
      parseCommonsFiles({
        query: {
          geosearch: [{ title: "File:A.jpg" }, { title: "Category:X" }, { title: "File:B.jpg" }],
        },
      }),
    ).toEqual(["File:A.jpg", "File:B.jpg"]);
  });
});

describe("parseCommonsImages (multi-title imageinfo)", () => {
  const info = {
    query: {
      pages: {
        "1": {
          imageinfo: [
            {
              thumburl: "https://upload.wikimedia.org/a/thumb.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg",
              extmetadata: {
                Artist: { value: "<a>Jane</a>" },
                LicenseShortName: { value: "CC BY-SA 4.0" },
              },
            },
          ],
        },
        "2": { imageinfo: [{ url: "https://upload.wikimedia.org/b.jpg" }] },
      },
    },
  };

  it("returns one TrekImage per page, with a plain-text credit", () => {
    const imgs = parseCommonsImages(info);
    expect(imgs).toHaveLength(2);
    expect(imgs[0].url).toContain("thumb.jpg");
    expect(imgs[0].attribution).toContain("Jane");
    expect(imgs[0].attribution).toContain("CC BY-SA 4.0");
    expect(imgs[0].attribution).toContain("commons.wikimedia.org/wiki/File:A.jpg");
  });

  it("parseCommonsImageInfo returns the first image", () => {
    expect(parseCommonsImageInfo(info)?.url).toContain("thumb.jpg");
    expect(parseCommonsImages({})).toEqual([]);
  });
});
