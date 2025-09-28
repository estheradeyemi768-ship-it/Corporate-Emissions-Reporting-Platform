import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_REPORT_ID = 101;
const ERR_INVALID_COMPANY = 102;
const ERR_INVALID_EMISSIONS = 105;
const ERR_INVALID_THRESHOLD = 106;
const ERR_AUDIT_ALREADY_PERFORMED = 104;
const ERR_INVALID_AUDIT_TYPE = 111;
const ERR_INVALID_ORACLE_DATA = 115;
const ERR_INVALID_INDUSTRY = 118;
const ERR_INVALID_METRIC = 119;
const ERR_AUTHORITY_NOT_VERIFIED = 110;
const ERR_MAX_AUDITS_EXCEEDED = 121;
const ERR_INVALID_UPDATE_PARAM = 122;
const ERR_INVALID_AUDIT_RESULT = 120;
const ERR_BATCH_LIMIT_EXCEEDED = 114;

interface Audit {
  reportId: number;
  company: string;
  emissions: number;
  threshold: number;
  timestamp: number;
  auditor: string;
  compliance: boolean;
  auditType: string;
  penaltyTriggered: boolean;
  rewardTriggered: boolean;
  oracleData: number;
  industry: string;
  metric: string;
}

interface AuditUpdate {
  updateEmissions: number;
  updateThreshold: number;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class AuditContractMock {
  state: {
    nextAuditId: number;
    maxAudits: number;
    auditFee: number;
    authorityContract: string | null;
    batchLimit: number;
    auditFrequency: number;
    audits: Map<number, Audit>;
    auditUpdates: Map<number, AuditUpdate>;
    auditResultsByReport: Map<number, number>;
  } = {
    nextAuditId: 0,
    maxAudits: 10000,
    auditFee: 500,
    authorityContract: null,
    batchLimit: 50,
    auditFrequency: 365,
    audits: new Map(),
    auditUpdates: new Map(),
    auditResultsByReport: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextAuditId: 0,
      maxAudits: 10000,
      auditFee: 500,
      authorityContract: null,
      batchLimit: 50,
      auditFrequency: 365,
      audits: new Map(),
      auditUpdates: new Map(),
      auditResultsByReport: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setAuditFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.auditFee = newFee;
    return { ok: true, value: true };
  }

  setBatchLimit(newLimit: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newLimit <= 0 || newLimit > 100) return { ok: false, value: false };
    this.state.batchLimit = newLimit;
    return { ok: true, value: true };
  }

  performAudit(
    reportId: number,
    company: string,
    emissions: number,
    threshold: number,
    auditType: string,
    oracleData: number,
    industry: string,
    metric: string
  ): Result<number> {
    if (this.state.nextAuditId >= this.state.maxAudits) return { ok: false, value: ERR_MAX_AUDITS_EXCEEDED };
    if (reportId <= 0) return { ok: false, value: ERR_INVALID_REPORT_ID };
    if (company === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_COMPANY };
    if (emissions <= 0) return { ok: false, value: ERR_INVALID_EMISSIONS };
    if (threshold <= 0) return { ok: false, value: ERR_INVALID_THRESHOLD };
    if (!["annual", "quarterly", "monthly"].includes(auditType)) return { ok: false, value: ERR_INVALID_AUDIT_TYPE };
    if (oracleData < 0) return { ok: false, value: ERR_INVALID_ORACLE_DATA };
    if (!industry || industry.length > 50) return { ok: false, value: ERR_INVALID_INDUSTRY };
    if (!["CO2", "CH4", "N2O"].includes(metric)) return { ok: false, value: ERR_INVALID_METRIC };
    if (this.state.auditResultsByReport.has(reportId)) return { ok: false, value: ERR_AUDIT_ALREADY_PERFORMED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_AUTHORITY_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.auditFee, from: this.caller, to: this.state.authorityContract });

    const id = this.state.nextAuditId;
    const compliance = emissions < threshold;
    const audit: Audit = {
      reportId,
      company,
      emissions,
      threshold,
      timestamp: this.blockHeight,
      auditor: this.caller,
      compliance,
      auditType,
      penaltyTriggered: !compliance,
      rewardTriggered: compliance,
      oracleData,
      industry,
      metric,
    };
    this.state.audits.set(id, audit);
    this.state.auditResultsByReport.set(reportId, id);
    this.state.nextAuditId++;
    return { ok: true, value: id };
  }

  getAudit(id: number): Audit | null {
    return this.state.audits.get(id) || null;
  }

  updateAudit(id: number, updateEmissions: number, updateThreshold: number): Result<boolean> {
    const audit = this.state.audits.get(id);
    if (!audit) return { ok: false, value: ERR_INVALID_AUDIT_RESULT };
    if (audit.auditor !== this.caller) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (updateEmissions <= 0) return { ok: false, value: ERR_INVALID_EMISSIONS };
    if (updateThreshold <= 0) return { ok: false, value: ERR_INVALID_THRESHOLD };

    const newCompliance = updateEmissions < updateThreshold;
    const updated: Audit = {
      ...audit,
      emissions: updateEmissions,
      threshold: updateThreshold,
      timestamp: this.blockHeight,
      compliance: newCompliance,
      penaltyTriggered: !newCompliance,
      rewardTriggered: newCompliance,
    };
    this.state.audits.set(id, updated);
    this.state.auditUpdates.set(id, {
      updateEmissions,
      updateThreshold,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  batchAudit(reportIds: number[]): Result<number> {
    if (reportIds.length > this.state.batchLimit) return { ok: false, value: ERR_BATCH_LIMIT_EXCEEDED };
    let count = 0;
    for (const reportId of reportIds) {
      const result = this.performAudit(reportId, this.caller, 1000, 2000, "annual", 0, "energy", "CO2");
      if (!result.ok) return { ok: false, value: result.value };
      count++;
    }
    return { ok: true, value: count };
  }

  getAuditCount(): Result<number> {
    return { ok: true, value: this.state.nextAuditId };
  }
}

describe("AuditContract", () => {
  let contract: AuditContractMock;

  beforeEach(() => {
    contract = new AuditContractMock();
    contract.reset();
  });

  it("performs an audit successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const audit = contract.getAudit(0);
    expect(audit?.reportId).toBe(1);
    expect(audit?.company).toBe("ST3COMP");
    expect(audit?.emissions).toBe(1500);
    expect(audit?.threshold).toBe(2000);
    expect(audit?.compliance).toBe(true);
    expect(audit?.penaltyTriggered).toBe(false);
    expect(audit?.rewardTriggered).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects duplicate audit for same report", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    const result = contract.performAudit(1, "ST3COMP", 1600, 2000, "annual", 0, "energy", "CO2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUDIT_ALREADY_PERFORMED);
  });

  it("rejects audit without authority contract", () => {
    const result = contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AUTHORITY_NOT_VERIFIED);
  });

  it("rejects invalid emissions", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.performAudit(1, "ST3COMP", 0, 2000, "annual", 0, "energy", "CO2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EMISSIONS);
  });

  it("rejects invalid audit type", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.performAudit(1, "ST3COMP", 1500, 2000, "invalid", 0, "energy", "CO2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AUDIT_TYPE);
  });

  it("updates an audit successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    const result = contract.updateAudit(0, 1600, 1800);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const audit = contract.getAudit(0);
    expect(audit?.emissions).toBe(1600);
    expect(audit?.threshold).toBe(1800);
    expect(audit?.compliance).toBe(true);
    const update = contract.state.auditUpdates.get(0);
    expect(update?.updateEmissions).toBe(1600);
    expect(update?.updateThreshold).toBe(1800);
    expect(update?.updater).toBe("ST1TEST");
  });

  it("rejects update for non-existent audit", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateAudit(99, 1600, 1800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AUDIT_RESULT);
  });

  it("rejects update by non-auditor", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    contract.caller = "ST3FAKE";
    const result = contract.updateAudit(0, 1600, 1800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets audit fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setAuditFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.auditFee).toBe(1000);
    contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    expect(contract.stxTransfers).toEqual([{ amount: 1000, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("performs batch audit successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.batchAudit([1, 2, 3]);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);
    expect(contract.state.nextAuditId).toBe(3);
  });

  it("rejects batch audit exceeding limit", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.setBatchLimit(2);
    const result = contract.batchAudit([1, 2, 3]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_LIMIT_EXCEEDED);
  });

  it("returns correct audit count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    contract.performAudit(2, "ST3COMP", 1600, 2000, "quarterly", 0, "manufacturing", "CH4");
    const result = contract.getAuditCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("rejects audit with max audits exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxAudits = 1;
    contract.performAudit(1, "ST3COMP", 1500, 2000, "annual", 0, "energy", "CO2");
    const result = contract.performAudit(2, "ST3COMP", 1600, 2000, "annual", 0, "energy", "CO2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_AUDITS_EXCEEDED);
  });

  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });

  it("rejects invalid authority contract", () => {
    const result = contract.setAuthorityContract("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});