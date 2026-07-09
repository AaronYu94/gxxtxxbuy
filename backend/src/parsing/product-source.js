// ProductSourceAdapter contract — the single seam every data source implements:
//
//   fetchProduct(ref) -> { title, spec, priceCents, currency, images, skus } | null
//
// `ref` is the output of extractProductRef(). Returning null means "could not resolve"
// and the link falls back to manual completion. Swap this placeholder for a real source
// (a third-party item API, or a self-built Taobao mtop / 1688 scraper) with no changes
// upstream — the parse worker and core service only know this interface.

const TITLES = [
  "Retro Low Sneaker", "Tech Fleece Hoodie", "Cargo Trousers", "Puffer Jacket",
  "Knit Beanie", "Canvas Tote", "Windbreaker Shell", "Chunky Dad Sneaker"
];
const COLORS = ["Black", "Grey", "Olive", "Cream", "Navy", "Sail", "Bone", "Triple White"];
const SIZES = ["38", "40", "42", "44", "S", "M", "L", "XL"];

export function createPlaceholderProductSource() {
  return {
    name: "placeholder",

    async fetchProduct(ref) {
      // Unresolvable refs (short links, unknown, missing id) → manual completion.
      if (!ref?.itemId || ref.kind === "short" || ref.kind === "unknown") {
        return null;
      }
      const seed = seedFromId(ref.itemId);

      // Yupoo albums have images but no price/spec → still needs the buyer to fill details.
      if (ref.platform === "Yupoo" || ref.kind === "album") {
        return {
          title: `${pick(TITLES, seed)} — Yupoo album`,
          spec: "",
          priceCents: null,
          currency: "USD",
          images: albumImages(ref),
          skus: []
        };
      }

      const color = pick(COLORS, seed);
      const priceCents = 1500 + (seed % 8000);
      return {
        title: pick(TITLES, seed),
        spec: `${color} / ${pick(SIZES, seed >> 2)}`,
        priceCents,
        currency: "USD",
        images: [imageUrl(ref, 1), imageUrl(ref, 2), imageUrl(ref, 3)],
        skus: SIZES.slice(0, 4).map((size) => ({ spec: `${color} / ${size}`, priceCents }))
      };
    }
  };
}

function seedFromId(itemId) {
  let sum = 0;
  for (const ch of String(itemId)) sum = (sum + ch.charCodeAt(0)) % 100000;
  return sum;
}

function pick(list, seed) {
  return list[seed % list.length];
}

function imageUrl(ref, n) {
  return `https://placeholder.goatedbuy.local/${ref.platform.toLowerCase()}/${ref.itemId}/${n}.jpg`;
}

function albumImages(ref) {
  return [1, 2, 3, 4].map((n) => imageUrl(ref, n));
}
