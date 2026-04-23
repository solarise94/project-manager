import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;
let etherealAccount: nodemailer.TestAccount | null = null;
let isRealSMTP = false;

function getSMTPConfig() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && port && user && pass) {
    return {
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    };
  }
  return null;
}

async function createEtherealTransporter(): Promise<nodemailer.Transporter> {
  if (!etherealAccount) {
    etherealAccount = await nodemailer.createTestAccount();
    console.log("[SMTP] Using Ethereal test account (no real SMTP configured)");
    console.log("  Preview URL base: https://ethereal.email");
    console.log("  User:", etherealAccount.user);
  }
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: etherealAccount.user,
      pass: etherealAccount.pass,
    },
  });
}

export async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  const realConfig = getSMTPConfig();
  if (realConfig) {
    transporter = nodemailer.createTransport(realConfig);
    isRealSMTP = true;
    console.log("[SMTP] Real SMTP configured:", realConfig.host);
  } else {
    transporter = await createEtherealTransporter();
    isRealSMTP = false;
  }

  return transporter;
}

export async function sendReminderEmail({
  to,
  ticketTitle,
  projectName,
}: {
  to: string;
  ticketTitle: string;
  projectName: string;
}) {
  const transport = await getTransporter();
  const fromAddr = process.env.SMTP_FROM || '"SciManage 提醒" <reminder@scimanage.com>';

  const info = await transport.sendMail({
    from: fromAddr,
    to,
    subject: `[SciManage] 工单提醒: ${ticketTitle}`,
    text: `您好，\n\n您创建的工单 "${ticketTitle}"（项目: ${projectName}）即将到达提醒时间，请关注处理进度。\n\n---\nSciManage 科研项目管理平台`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #2563eb;">SciManage 工单提醒</h2>
        <p>您好，</p>
        <p>您创建的工单 <strong>"${ticketTitle}"</strong> 即将到达提醒时间。</p>
        <p>所属项目: <strong>${projectName}</strong></p>
        <p>请关注处理进度。</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px;">SciManage 科研项目管理平台</p>
      </div>
    `,
  });

  if (!isRealSMTP) {
    const preview = nodemailer.getTestMessageUrl(info);
    console.log("[SMTP] Preview URL:", preview);
    return { messageId: info.messageId, previewUrl: preview };
  }

  console.log("[SMTP] Real email sent:", info.messageId);
  return { messageId: info.messageId };
}
