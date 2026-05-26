import { registerProjectActions } from "./projects";
import { registerOrderActions } from "./orders";
import { registerCrmActions } from "./crm";
import { registerFinanceActions } from "./finance";
import { registerTicketActions } from "./tickets";

export function registerBuiltinAgentActions() {
  registerProjectActions();
  registerOrderActions();
  registerCrmActions();
  registerFinanceActions();
  registerTicketActions();
}
