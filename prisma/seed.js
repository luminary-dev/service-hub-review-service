// Seeds review_db with the same demo reviews as the monolith seed, using
// deterministic ids that line up with the identity-service (user_*) and
// provider-service (prov_*) seeds.
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const REVIEWS = [
  { id: "rev_1", providerId: "prov_nuwan", userId: "user_dilani", rating: 5, comment: "Fixed my Aqua's brake issue the same day and charged exactly what he quoted. Very honest mechanic." },
  { id: "rev_2", providerId: "prov_nuwan", userId: "user_ashan", rating: 4, comment: "Good service, explained everything clearly. Workshop gets busy so book ahead." },
  { id: "rev_3", providerId: "prov_sampath", userId: "user_dilani", rating: 5, comment: "Rewired our entire house in Kadawatha. Neat work, proper earthing, passed inspection first time." },
  { id: "rev_4", providerId: "prov_kumari", userId: "user_tharindu", rating: 5, comment: "Kumari transformed our bare backyard into a beautiful tropical garden. Worth every rupee." },
  { id: "rev_5", providerId: "prov_kumari", userId: "user_ashan", rating: 5, comment: "Very knowledgeable about native plants. The garden survived the dry season perfectly." },
  { id: "rev_6", providerId: "prov_roshan", userId: "user_tharindu", rating: 4, comment: "Came within two hours for a burst pipe. Tidy and fast." },
  { id: "rev_7", providerId: "prov_chaminda", userId: "user_dilani", rating: 5, comment: "The pantry cupboards are stunning. Real craftsmanship you rarely see these days." },
];

async function main() {
  await db.reviewPhoto.deleteMany();
  await db.review.deleteMany();

  for (const r of REVIEWS) {
    await db.review.create({ data: r });
  }

  console.log(`Seeded ${REVIEWS.length} reviews.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
