(() => {
  "use strict";

  /**
   * giscus（GitHub Discussions）配置。
   * category_id 需在仓库开启 Discussions 后，用
   * `node tools/scripts/fetch-giscus-ids.cjs` 或 https://giscus.app/zh-CN 填入。
   */
  window.DevToolsGiscusConfig = {
    enabled: true,
    repo: "Afra55/Afra55.github.io",
    repoId: "MDEwOlJlcG9zaXRvcnk0Njg1MDkxNw==",
    category: "Announcements",
    /** 开启 Discussions 并安装 giscus App 后填入，例如 DIC_kwDO... */
    categoryId: "DIC_kwDOAsrjZc4DEww8",
    mapping: "specific",
    strict: "0",
    reactionsEnabled: "0",
    emitMetadata: "0",
    inputPosition: "bottom",
    lang: "zh-CN",
  };
})();
