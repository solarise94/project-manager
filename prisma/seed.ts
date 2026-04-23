import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Clean up
  await prisma.activityLog.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // Create users
  const admin = await prisma.user.create({
    data: {
      email: "solarise_@live.com",
      name: "solarise_",
      password: await bcrypt.hash("WZwz19940203", 12),
      role: "ADMIN",
    },
  });

  const user1 = await prisma.user.create({
    data: {
      email: "2805223715@qq.com",
      name: "2805223715",
      password: await bcrypt.hash("hanshuangnizhenbang_HOLD58", 12),
      role: "ADMIN",
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: "864302186@qq.com",
      name: "864302186",
      password: await bcrypt.hash("ywx-chaojientj888", 12),
      role: "USER",
    },
  });

  // Create projects
  const project1 = await prisma.project.create({
    data: {
      name: "肺癌单细胞测序分析",
      description: "对50例肺癌患者肿瘤组织进行单细胞RNA测序，分析肿瘤微环境中的免疫细胞组成与功能状态。",
      orderNumber: "SC-2026-001",
      organization: "中科院基因组所",
      client: "协和医院",
      representative: "张研究员",
      status: "IN_PROGRESS",
      progress: 65,
      startDate: new Date("2026-01-15"),
      endDate: new Date("2026-06-30"),
      members: {
        create: [
          { userId: admin.id, role: "OWNER" },
          { userId: user1.id, role: "MEMBER" },
        ],
      },
    },
  });

  const project2 = await prisma.project.create({
    data: {
      name: "肝脏空间转录组图谱",
      description: "构建正常人肝脏的空间转录组图谱，解析肝小叶分区基因表达特征。",
      orderNumber: "SC-2026-002",
      organization: "北京大学医学部",
      client: "人民医院",
      representative: "李博士",
      status: "NOT_STARTED",
      progress: 0,
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-12-31"),
      members: {
        create: [
          { userId: user2.id, role: "OWNER" },
          { userId: admin.id, role: "MEMBER" },
        ],
      },
    },
  });

  const project3 = await prisma.project.create({
    data: {
      name: "阿尔茨海默病脑组织scRNA-seq",
      description: "对比AD患者与正常对照脑组织的单细胞表达谱，寻找疾病相关的细胞亚群标志物。",
      orderNumber: "SC-2025-088",
      organization: "首都医科大学",
      client: "宣武医院",
      representative: "王教授",
      status: "COMPLETED",
      progress: 100,
      startDate: new Date("2025-06-01"),
      endDate: new Date("2026-03-15"),
      members: {
        create: [
          { userId: user1.id, role: "OWNER" },
          { userId: user2.id, role: "MEMBER" },
        ],
      },
    },
  });

  const project4 = await prisma.project.create({
    data: {
      name: "肠道微生物-宿主互作单细胞研究",
      description: "结合单细胞测序与空间转录组技术，研究肠道菌群对肠上皮细胞功能的影响。",
      orderNumber: "SC-2026-015",
      organization: "浙江大学医学院",
      client: "浙大一院",
      representative: "赵博士",
      status: "ON_HOLD",
      progress: 30,
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-08-31"),
      members: {
        create: [
          { userId: admin.id, role: "OWNER" },
        ],
      },
    },
  });

  // Create tickets
  await prisma.ticket.createMany({
    data: [
      {
        title: "样本质控未通过",
        description: "批次B的12个样本RIN值低于7，需要重新提取RNA",
        status: "OPEN",
        priority: "HIGH",
        projectId: project1.id,
        assigneeId: user1.id,
      },
      {
        title: "细胞注释参考库更新",
        description: "需要使用最新版CellTypist模型对免疫细胞进行重新注释",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        projectId: project1.id,
        assigneeId: user2.id,
      },
      {
        title: "空间转录组切片制备",
        description: "完成10张肝脏组织切片的OCT包埋与冷冻切片",
        status: "OPEN",
        priority: "URGENT",
        projectId: project2.id,
        assigneeId: admin.id,
      },
      {
        title: "数据上传至GEO",
        description: "整理AD项目原始数据并提交至NCBI GEO数据库",
        status: "CLOSED",
        priority: "MEDIUM",
        projectId: project3.id,
        assigneeId: user1.id,
      },
      {
        title: "文献综述撰写",
        description: "完成肠道微生物单细胞研究领域的文献综述",
        status: "OPEN",
        priority: "LOW",
        projectId: project4.id,
        assigneeId: user2.id,
      },
    ],
  });

  // Create comments
  await prisma.comment.createMany({
    data: [
      { content: "样本已经重新送检，预计下周拿到结果", projectId: project1.id, authorId: user1.id },
      { content: "质控标准建议放宽到RIN>6.5，这样可以保留更多样本", projectId: project1.id, authorId: admin.id },
      { content: "肝脏组织的冷冻切片已经完成5张，质量良好", projectId: project2.id, authorId: admin.id },
      { content: "GEO提交已经完成，登录号为GSE2024001", projectId: project3.id, authorId: user1.id },
    ],
  });

  // Create activity logs
  await prisma.activityLog.createMany({
    data: [
      { type: "PROJECT_CREATED", content: "创建了项目", projectId: project1.id, userId: admin.id },
      { type: "PROJECT_CREATED", content: "创建了项目", projectId: project2.id, userId: user2.id },
      { type: "PROJECT_CREATED", content: "创建了项目", projectId: project3.id, userId: user1.id },
      { type: "PROJECT_CREATED", content: "创建了项目", projectId: project4.id, userId: admin.id },
      { type: "STATUS_CHANGED", content: "项目状态从 NOT_STARTED 变更为 IN_PROGRESS", projectId: project1.id, userId: admin.id, metadata: JSON.stringify({ oldStatus: "NOT_STARTED", newStatus: "IN_PROGRESS" }) },
      { type: "STATUS_CHANGED", content: "项目状态从 IN_PROGRESS 变更为 COMPLETED", projectId: project3.id, userId: user1.id, metadata: JSON.stringify({ oldStatus: "IN_PROGRESS", newStatus: "COMPLETED" }) },
      { type: "STATUS_CHANGED", content: "项目状态从 IN_PROGRESS 变更为 ON_HOLD", projectId: project4.id, userId: admin.id, metadata: JSON.stringify({ oldStatus: "IN_PROGRESS", newStatus: "ON_HOLD" }) },
      { type: "PROGRESS_UPDATED", content: "项目进度更新为 65%", projectId: project1.id, userId: user1.id, metadata: JSON.stringify({ oldProgress: 50, newProgress: 65 }) },
      { type: "COMMENT_ADDED", content: "发表了评论", projectId: project1.id, userId: user1.id },
      { type: "COMMENT_ADDED", content: "发表了评论", projectId: project1.id, userId: admin.id },
      { type: "TICKET_CREATED", content: "创建了工单 \"样本质控未通过\"", projectId: project1.id, userId: admin.id },
      { type: "TICKET_CREATED", content: "创建了工单 \"细胞注释参考库更新\"", projectId: project1.id, userId: user1.id },
    ],
  });

  // Create demo notifications
  await prisma.notification.createMany({
    data: [
      {
        userId: admin.id,
        title: "欢迎使用 SciManage",
        content: "SciManage 是专为单细胞测序与空间转录组科研项目打造的管理平台。",
        type: "SYSTEM",
        read: false,
      },
      {
        userId: admin.id,
        title: "项目进度更新",
        content: "肺癌单细胞测序分析项目进度已更新至 65%。",
        type: "STATUS",
        read: false,
        link: `/projects/${project1.id}`,
      },
      {
        userId: admin.id,
        title: "新工单创建",
        content: "样本质控未通过工单已创建，请尽快处理。",
        type: "TICKET",
        read: true,
        link: `/projects/${project1.id}`,
      },
      {
        userId: user1.id,
        title: "欢迎使用 SciManage",
        content: "SciManage 是专为单细胞测序与空间转录组科研项目打造的管理平台。",
        type: "SYSTEM",
        read: false,
      },
      {
        userId: user1.id,
        title: "项目已完成",
        content: "阿尔茨海默病脑组织scRNA-seq项目已标记为完成。",
        type: "STATUS",
        read: false,
        link: `/projects/${project3.id}`,
      },
      {
        userId: user2.id,
        title: "欢迎使用 SciManage",
        content: "SciManage 是专为单细胞测序与空间转录组科研项目打造的管理平台。",
        type: "SYSTEM",
        read: false,
      },
    ],
  });

  console.log("Seed completed successfully!");
  console.log("Demo accounts:");
  console.log("  solarise_@live.com / WZwz19940203");
  console.log("  2805223715@qq.com / hanshuangnizhenbang_HOLD58");
  console.log("  864302186@qq.com / ywx-chaojientj888");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
