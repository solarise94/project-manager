/**
 * Generate a sequential customer code in KH-000001 format.
 * Accepts an optional transaction client for use within $transaction blocks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateCustomerCode(tx?: any): Promise<string> {
  const client = tx ?? (await import("@/lib/prisma")).prisma;
  const count = await client.customer.count({});
  for (let i = 0; i < 10; i++) {
    const code = `KH-${String(count + 1 + i).padStart(6, "0")}`;
    const exists = await client.customer.findUnique({ where: { customerCode: code }, select: { id: true } });
    if (!exists) return code;
  }
  return `KH-${String(Date.now() % 1000000).padStart(6, "0")}`;
}
