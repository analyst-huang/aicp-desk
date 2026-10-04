import { hasActiveImageConfig } from './catalog.mjs';

export class ImagesService {
  saveImageOptions(...args) { return this.catalog.saveImageOptions(...args); }
  listSaveImageNamespaces(...args) { return this.api.listSaveImageNamespaces(...args); }
  listSaveImageRepositories(...args) { return this.api.listSaveImageRepositories(...args); }
  listImageRepos(...args) { return this.api.listImageRepos(...args); }
  listImageTags(...args) { return this.api.listImageTags(...args); }
  constructor({ api, config, catalog }) {
    Object.assign(this, { api, config, catalog });
  }

  async saveNotebookImage(id, variables, region) {
    const payload = { ...variables, Region: this.api.region(region || variables.Region), NotebookId: id };
    payload.ImagePermission ||= "Public";
    return this.api.withSession(async () => {
      if (payload.ImageType === "Personal") {
        const [config, namespaces] = await Promise.all([
          this.api.imageConfig(payload.Region),
          this.api.listSaveImageNamespaces("Personal", { region: payload.Region }),
        ]);
        const namespace = namespaces.find((item) => item.Namespace === payload.Namespace);
        if (!namespace) throw new Error(`个人版命名空间“${payload.Namespace}”当前不可用，请刷新后重新选择`);
        payload.NamespacePermission = namespace.Public ? "Public" : "Private";
        payload.ImageDomain = namespace.InternalEndpoint;
        if (!payload.ImageDomain) throw new Error(`个人版命名空间“${payload.Namespace}”没有可用的内网上传地址，请先在 KCR 中完成内网访问配置`);
        const configured = hasActiveImageConfig(config);
        if (!configured && !payload.Password) throw new Error("首次使用个人版镜像服务时必须填写 KCR 密码");
        if (!configured) payload.CreateImageConfig = true;
        else {
          delete payload.Password;
          delete payload.CreateImageConfig;
        }
      } else if (payload.ImageType === "Official") {
        const instances = await this.api.listKcrInstances(payload.Region);
        const instance = instances.find((item) => item.InstanceId === payload.OfficialInstance);
        if (!instance) throw new Error(`企业版镜像实例“${payload.OfficialInstance}”当前不可用，请刷新后重新选择`);
        const namespaces = await this.api.listSaveImageNamespaces("Official", { instanceId: instance.InstanceId, region: payload.Region });
        const namespace = namespaces.find((item) => item.Namespace === payload.Namespace);
        if (!namespace) throw new Error(`企业版命名空间“${payload.Namespace}”当前不可用，请重新选择`);
        const repositories = await this.api.listSaveImageRepositories("Official", payload.Namespace, { instanceId: instance.InstanceId, region: payload.Region });
        if (!repositories.some((item) => item.RepoName === payload.ImageRepo)) throw new Error(`企业版镜像仓库“${payload.ImageRepo}”当前不可用，请重新选择`);
        payload.RegistryInstanceId = instance.InstanceId;
        payload.ImageDomain = namespace.InternalEndpoint || instance.InternalEndpoint;
        if (!payload.ImageDomain) throw new Error(`企业版实例“${instance.InstanceName || instance.InstanceId}”没有可用的内网上传地址，请先在 KCR 中完成当前 VPC 的内网访问配置`);
        payload.NamespacePermission = namespace.Public ? "Public" : "Private";
      }
      return this.api.submitNotebookImage(payload);
    });
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
