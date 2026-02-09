

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.BFij7fXI.js","_app/immutable/chunks/C8WMVNin.js","_app/immutable/chunks/B_PiQ68N.js","_app/immutable/chunks/Csl9sg0z.js"];
export const stylesheets = ["_app/immutable/assets/2.Cwfcd7nv.css"];
export const fonts = [];
