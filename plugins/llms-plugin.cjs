const { generateLlmsFiles } = require('./llms/generator.cjs');

module.exports = function llmsPlugin() {
  return {
    name: 'babylon-llms-files',
    async postBuild({ outDir, routesPaths }) {
      const result = generateLlmsFiles({
        baseUrl: process.env.LLMS_BASE_URL || 'https://docs.babylonlabs.io',
        outDir,
        routesPaths,
      });

      console.log(
        `[llms] Generated ${result.pages.length} Markdown pages, ` +
          `${result.sectionFiles.length} section files, llms.txt, and ` +
          `llms-full.txt from ${result.provenance.sourceCommit}.`
      );
    },
  };
};
