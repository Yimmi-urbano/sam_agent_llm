/**
 * Wrapper CommonJS para Passenger/Plesk
 * Este archivo permite que Passenger cargue la aplicación ESM usando dynamic import
 * La extensión .cjs fuerza CommonJS incluso con "type": "module" en package.json
 */
(async () => {
  try {
    // Dynamic import para cargar el módulo ESM
    await import('./dist/index.js');
  } catch (error) {
    console.error('Error loading application:', error);
    process.exit(1);
  }
})();

