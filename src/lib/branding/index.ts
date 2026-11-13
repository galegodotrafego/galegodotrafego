/** Public, build-time branding. Never place credentials in NEXT_PUBLIC variables. */
export function localBrandAsset(value: string | undefined): string | undefined {
  const path = value?.trim();
  return path && /^\/(?!\/)[a-zA-Z0-9_./-]+$/.test(path) && !path.includes('..') ? path : undefined;
}

export function brandColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#7c3aed';
}

export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME?.trim().slice(0, 60) || 'Identidade CRM',
  description: 'Atendimento, contatos e vendas da sua empresa em um só lugar.',
  logo: localBrandAsset(process.env.NEXT_PUBLIC_BRAND_LOGO),
  favicon: localBrandAsset(process.env.NEXT_PUBLIC_BRAND_FAVICON),
  color: brandColor(process.env.NEXT_PUBLIC_BRAND_COLOR),
};
