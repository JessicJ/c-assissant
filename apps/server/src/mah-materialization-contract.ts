import { MahCarrierError } from "./mah-generation-contract.js";

/** No verified public replacement for execution-carriers is currently wired. */
export function assertMahMaterializationContract(): void {
  throw new MahCarrierError(
    "mah_task_materialization_contract_unverified",
    "MAH 任务物化核验的公开接口尚未确认，未提交任务。已保存的请求身份和检查点保持不变。"
  );
}
