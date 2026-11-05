import { CHARACTERS } from '@hairto-arena/shared';

/** Cosmetic metadata referenced by the NEAR character catalog. */
export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const match = /^(0|[1-9]\d*)\.json$/.exec(file);
  const id = match ? Number(match[1]) : NaN;
  const meta = Number.isSafeInteger(id) ? CHARACTERS.find((character) => character.id === id) : undefined;
  if (!meta) return Response.json({ error: 'unknown character' }, { status: 404 });
  return Response.json({
    name: meta.name,
    description: meta.description,
    image: meta.model,
    properties: { model: meta.model },
  });
}
