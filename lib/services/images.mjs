
export class ImagesService {
  saveImageOptions(...args) { return this.api.saveImageOptions(...args); }
  listSaveImageNamespaces(...args) { return this.api.listSaveImageNamespaces(...args); }
  listSaveImageRepositories(...args) { return this.api.listSaveImageRepositories(...args); }
  listImageRepos(...args) { return this.api.listImageRepos(...args); }
  listImageTags(...args) { return this.api.listImageTags(...args); }
  constructor({ api, templates, config, services, now = Date.now }) {
    Object.assign(this, { api, templates, config, services, now });
  }

  async listImages(options = {}) {
    const kind = String(options.kind ?? "train").toLowerCase();
    if (!["train", "dev"].includes(kind)) throw new Error("--kind 必须是 train 或 dev");
    const source = String(options.source ?? "all").toLowerCase();
    if (!["all", "official", "personal"].includes(source)) {
      throw new Error("--source 必须是 all、official 或 personal；第三方镜像请从镜像仓库和标签中选择");
    }

    const sources = source === "all"
      ? ["Official", "Personal"]
      : [source === "official" ? "Official" : "Personal"];
    const groups = await Promise.all(sources.map(async (imageSource) => ({
      source: imageSource,
      images: await this.api.listImages(imageSource, options.region, {
        applicationScenario: kind === "train" && imageSource === "Official" ? "训练任务" : undefined,
      }),
    })));
    const images = groups.flatMap((group) => group.images.map((item) => ({
      ...item,
      ImageSource: group.source,
    })));
    const search = String(options.search ?? "").trim().toLowerCase();
    const filtered = search
      ? images.filter((item) => [
        item.ImageName,
        item.ImageRepo,
        item.ImageVersion,
        Array.isArray(item.ImageFrame) ? item.ImageFrame.join(" ") : item.ImageFrame,
        item.PythonVersion,
        item.CudaVersion,
        item.Description,
        item.ImageId,
      ].some((value) => String(value ?? "").toLowerCase().includes(search)))
      : images;

    return {
      region: options.region || this.config.region,
      kind,
      sources,
      total: filtered.length,
      images: filtered,
    };
  }
}
