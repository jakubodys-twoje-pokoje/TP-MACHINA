import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Kompletny stan obiektu odtworzony z bazy - to samo, co pobiera GUI jako
 * "all.json", tyle że czytane z znormalizowanych tabel, nie z pamięci przeglądarki.
 */
export async function readSnapshot(oid: string) {
  return prisma.property.findUnique({
    where: { oid },
    include: {
      translations: true,
      photos: { orderBy: { position: 'asc' } },
      params: { orderBy: { key: 'asc' } },
      definitions: { orderBy: [{ dictionary: 'asc' }, { hotresId: 'asc' }] },
      roomTypes: {
        orderBy: { hotresId: 'asc' },
        include: {
          translations: true,
          photos: { orderBy: { position: 'asc' } },
          facilities: true,
          rooms: true,
        },
      },
      rooms: { orderBy: { hotresId: 'asc' } },
      ratePlans: {
        orderBy: { hotresId: 'asc' },
        include: {
          translations: true,
          photos: { orderBy: { position: 'asc' } },
          discounts: { orderBy: { position: 'asc' } },
        },
      },
      addons: {
        orderBy: { hotresId: 'asc' },
        include: { ratePlanLinks: true, roomTypeLinks: true },
      },
      vouchers: { orderBy: { hotresId: 'asc' }, include: { translations: true } },
      tickets: { orderBy: { hotresId: 'asc' }, include: { translations: true } },
      reviews: { orderBy: { addDateRaw: 'desc' } },
      informator: { orderBy: [{ lang: 'asc' }, { title: 'asc' }] },
      users: { orderBy: { uid: 'asc' } },
    },
  });
}

/** Liczniki per tabela - do kafelków "co siedzi w bazie" w GUI. */
export async function readCounts(propertyId: number) {
  const [
    roomTypes, rooms, ratePlans, addons, vouchers, tickets, reviews,
    informator, users, params, definitions, photos,
  ] = await Promise.all([
    prisma.roomType.count({ where: { propertyId } }),
    prisma.room.count({ where: { propertyId } }),
    prisma.ratePlan.count({ where: { propertyId } }),
    prisma.addon.count({ where: { propertyId } }),
    prisma.voucher.count({ where: { propertyId } }),
    prisma.ticket.count({ where: { propertyId } }),
    prisma.review.count({ where: { propertyId } }),
    prisma.informatorItem.count({ where: { propertyId } }),
    prisma.propertyUser.count({ where: { propertyId } }),
    prisma.param.count({ where: { propertyId } }),
    prisma.definition.count({ where: { propertyId } }),
    prisma.propertyPhoto.count({ where: { propertyId } }),
  ]);

  return {
    roomTypes, rooms, ratePlans, addons, vouchers, tickets, reviews,
    informator, users, params, definitions, photos,
  };
}
