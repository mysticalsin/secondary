/**
 * NEW RECONSTRUCTION. Reads preserved DOM text as data. Does not import or run it.
 * The strings below are matched in the captured file; they are not a replacement client.
 */

export function mainSurface(text) {
  const dynamic = [...text.matchAll(/import\s*\(\s*["'](\.\/[^"']+\.js)["']/g)].map((match) => match[1]);
  const assets = [...text.matchAll(/["']((?:\.\/|assets\/)[^"']+\.(?:js|css))["']/g)].map((match) => match[1]);
  const v1 = [...text.matchAll(/["'`]\/v1\/[A-Za-z0-9_./-]{1,80}/g)].map((match) =>
    match[0].slice(1).replace(/\/$/, ""),
  );
  return {
    dynamicImports: [...new Set(dynamic)].sort(),
    assetLiterals: [...new Set(assets)].sort(),
    v1Literals: [...new Set(v1)].sort(),
    personaKey: text.includes('"secondary.persona"'),
    personaDefaultCeo: text.includes('Np="ceo"'),
    demoHeader: text.includes('"X-Demo-Persona"'),
    sameOrigin: text.includes('credentials:"same-origin"'),
    sourceMap: text.includes("sourceMappingURL"),
    callsMe: text.includes('"/v1/me"'),
    callsGenuiPlan: text.includes("/v1/genui/plan"),
    logos: ["/brand/logo_main.png", "/brand/logo_main_white.png"].filter((item) => text.includes(item)),
  };
}
