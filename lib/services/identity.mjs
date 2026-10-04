
export class IdentityService {
  constructor({ api }) {
    Object.assign(this, { api });
  }

  async currentUser() {
    const identity = await this.api.currentUser();
    if (!identity?.username || !identity?.userId) throw new Error("无法从登录态获取当前用户，请重新运行 aicp login");
    return identity;
  }

  creatorUsername(identity) {
    return identity.accountType === "iam" ? identity.username : "root";
  }

  trainingCreator(identity) {
    return identity.accountType === "iam" ? identity.userId : "root";
  }
}
