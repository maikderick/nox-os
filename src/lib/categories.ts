export type CategoryGroup = {
  id: string;
  label: string;
  osmTags: string[];
  keywords: string[];
};

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: "food",
    label: "Restaurantes, lanchonetes, cafeterias e padarias",
    osmTags: [
      'nwr["amenity"="restaurant"]',
      'nwr["amenity"="fast_food"]',
      'nwr["amenity"="cafe"]',
      'nwr["shop"="bakery"]',
    ],
    keywords: ["restaurante", "lanchonete", "cafeteria", "padaria"],
  },
  {
    id: "beauty",
    label: "Barbearias, salões e clínicas de estética",
    osmTags: [
      'nwr["shop"="hairdresser"]',
      'nwr["shop"="beauty"]',
      'nwr["amenity"="beauty"]',
    ],
    keywords: ["barbearia", "salão", "estética"],
  },
  {
    id: "fitness",
    label: "Academias e estúdios",
    osmTags: ['nwr["leisure"="fitness_centre"]', 'nwr["sport"="fitness"]'],
    keywords: ["academia", "estúdio"],
  },
  {
    id: "pet",
    label: "Pet shops e clínicas veterinárias",
    osmTags: ['nwr["shop"="pet"]', 'nwr["amenity"="veterinary"]'],
    keywords: ["pet", "veterinária"],
  },
  {
    id: "auto",
    label: "Oficinas e centros automotivos",
    osmTags: ['nwr["shop"="car_repair"]', 'nwr["amenity"="car_wash"]'],
    keywords: ["oficina", "automotivo"],
  },
  {
    id: "education",
    label: "Escolas, cursos e reforço escolar",
    osmTags: [
      'nwr["amenity"="school"]',
      'nwr["amenity"="college"]',
      'nwr["amenity"="language_school"]',
    ],
    keywords: ["escola", "curso", "reforço"],
  },
  {
    id: "retail",
    label: "Lojas de roupas, móveis, materiais e eletrônicos",
    osmTags: [
      'nwr["shop"="clothes"]',
      'nwr["shop"="furniture"]',
      'nwr["shop"="electronics"]',
      'nwr["shop"="doityourself"]',
    ],
    keywords: ["roupas", "móveis", "eletrônicos"],
  },
  {
    id: "events",
    label: "Fotógrafos e espaços de eventos",
    osmTags: [
      'nwr["craft"="photographer"]',
      'nwr["amenity"="events_venue"]',
      'nwr["leisure"="dance"]',
    ],
    keywords: ["fotógrafo", "eventos"],
  },
  {
    id: "realestate",
    label: "Imobiliárias",
    osmTags: ['nwr["office"="estate_agent"]'],
    keywords: ["imobiliária"],
  },
  {
    id: "professional",
    label: "Escritórios de contabilidade e advocacia",
    osmTags: [
      'nwr["office"="accountant"]',
      'nwr["office"="lawyer"]',
      'nwr["office"="tax_advisor"]',
    ],
    keywords: ["contabilidade", "advocacia"],
  },
  {
    id: "health",
    label: "Consultórios e clínicas",
    osmTags: [
      'nwr["amenity"="doctors"]',
      'nwr["amenity"="clinic"]',
      'nwr["amenity"="dentist"]',
    ],
    keywords: ["consultório", "clínica"],
  },
  {
    id: "services",
    label: "Prestadores de serviços locais",
    osmTags: ['nwr["office"="company"]', 'nwr["craft"]', 'nwr["shop"="laundry"]'],
    keywords: ["serviços"],
  },
  {
    id: "tourism",
    label: "Hotéis, pousadas e turismo",
    osmTags: [
      'nwr["tourism"="hotel"]',
      'nwr["tourism"="guest_house"]',
      'nwr["tourism"="hostel"]',
    ],
    keywords: ["hotel", "pousada", "turismo"],
  },
  {
    id: "catalog",
    label: "Negócios com catálogo, reservas, cardápio ou orçamento",
    osmTags: [
      'nwr["amenity"="restaurant"]',
      'nwr["tourism"="hotel"]',
      'nwr["shop"="florist"]',
    ],
    keywords: ["catálogo", "reservas", "cardápio", "orçamento"],
  },
];

export function categoryLabelFromOsm(tags: Record<string, string>): string {
  if (tags.amenity === "restaurant" || tags.amenity === "fast_food") return "Restaurantes";
  if (tags.amenity === "cafe") return "Cafeterias";
  if (tags.shop === "bakery") return "Padarias";
  if (tags.shop === "hairdresser") return "Barbearias e salões";
  if (tags.shop === "beauty") return "Estética";
  if (tags.leisure === "fitness_centre") return "Academias";
  if (tags.shop === "pet") return "Pet shops";
  if (tags.amenity === "veterinary") return "Clínicas veterinárias";
  if (tags.shop === "car_repair") return "Oficinas automotivas";
  if (tags.amenity === "school" || tags.amenity === "college") return "Escolas e cursos";
  if (tags.shop === "clothes") return "Lojas de roupas";
  if (tags.shop === "furniture") return "Lojas de móveis";
  if (tags.shop === "electronics") return "Eletrônicos";
  if (tags.office === "estate_agent") return "Imobiliárias";
  if (tags.office === "accountant") return "Contabilidade";
  if (tags.office === "lawyer") return "Advocacia";
  if (tags.amenity === "clinic" || tags.amenity === "doctors") return "Clínicas";
  if (tags.tourism === "hotel" || tags.tourism === "guest_house") return "Hotéis e pousadas";
  if (tags.shop) return `Comércio (${tags.shop})`;
  if (tags.amenity) return `Serviço (${tags.amenity})`;
  if (tags.office) return `Escritório (${tags.office})`;
  return "Serviços locais";
}
