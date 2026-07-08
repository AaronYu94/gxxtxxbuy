export const DEFAULT_SHIPPING_LINES = Object.freeze([
  {
    code: "US-BALANCED-AIR",
    name: "Balanced Air",
    destination_country: "United States",
    service_level: "standard",
    status: "active",
    currency: "USD",
    billing_rules: {
      base_cents: 1200,
      per_kg_cents: 1200,
      min_chargeable_grams: 500,
      volumetric_divisor: 6000
    },
    restriction_rules: {
      max_weight_grams: 30000,
      max_length_cm: 100,
      max_girth_cm: 180
    },
    delivery_min_days: 8,
    delivery_max_days: 15
  },
  {
    code: "US-ECONOMY",
    name: "Economy Line",
    destination_country: "United States",
    service_level: "economy",
    status: "active",
    currency: "USD",
    billing_rules: {
      base_cents: 900,
      per_kg_cents: 800,
      min_chargeable_grams: 1000,
      volumetric_divisor: 7000
    },
    restriction_rules: {
      max_weight_grams: 20000,
      max_length_cm: 90,
      max_girth_cm: 160
    },
    delivery_min_days: 12,
    delivery_max_days: 24
  },
  {
    code: "US-EXPRESS",
    name: "Express Line",
    destination_country: "United States",
    service_level: "express",
    status: "active",
    currency: "USD",
    billing_rules: {
      base_cents: 1800,
      per_kg_cents: 1800,
      min_chargeable_grams: 500,
      volumetric_divisor: 5000,
      fuel_surcharge_percent: 6
    },
    restriction_rules: {
      max_weight_grams: 15000,
      max_length_cm: 80,
      max_girth_cm: 150
    },
    delivery_min_days: 4,
    delivery_max_days: 8
  },
  {
    code: "UK-BALANCED-AIR",
    name: "UK Balanced Air",
    destination_country: "United Kingdom",
    service_level: "standard",
    status: "active",
    currency: "USD",
    billing_rules: {
      base_cents: 1300,
      per_kg_cents: 1350,
      min_chargeable_grams: 500,
      volumetric_divisor: 6000
    },
    restriction_rules: {
      max_weight_grams: 25000,
      max_length_cm: 100,
      max_girth_cm: 180
    },
    delivery_min_days: 7,
    delivery_max_days: 14
  },
  {
    code: "CA-BALANCED-AIR",
    name: "Canada Balanced Air",
    destination_country: "Canada",
    service_level: "standard",
    status: "active",
    currency: "USD",
    billing_rules: {
      base_cents: 1400,
      per_kg_cents: 1400,
      min_chargeable_grams: 500,
      volumetric_divisor: 6000
    },
    restriction_rules: {
      max_weight_grams: 25000,
      max_length_cm: 100,
      max_girth_cm: 180
    },
    delivery_min_days: 8,
    delivery_max_days: 16
  },
  {
    code: "AU-ECONOMY",
    name: "Australia Economy",
    destination_country: "Australia",
    service_level: "economy",
    status: "active",
    currency: "USD",
    billing_rules: {
      base_cents: 1500,
      per_kg_cents: 1250,
      min_chargeable_grams: 1000,
      volumetric_divisor: 7000
    },
    restriction_rules: {
      max_weight_grams: 20000,
      max_length_cm: 90,
      max_girth_cm: 160
    },
    delivery_min_days: 10,
    delivery_max_days: 22
  }
]);
