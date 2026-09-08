import { ChangeEvent, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  FileDown,
  FilePlus2,
  History,
  LayoutDashboard,
  Plus,
  Save,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./App.css";
import "./item-layout.css";
import "./entity-type.css";
import "./preview-layout.css";
import { calculateInvoiceTotals, calculateLineAmounts, TaxMode, TaxRate } from "./domain/invoiceTotals";

type Item = { id: string; name: string; quantity: number; unitPrice: number; taxRate: TaxRate; taxMode?: TaxMode };
type EntityType = "individual" | "corporate";
type Client = { id: string; entityType: EntityType; name: string; honorific: string; postalCode: string; address: string; contact: string };
type Invoice = {
  id: string;
  number: string;
  clientId: string;
  issuerType: EntityType;
  issueDate: string;
  dueDate: string;
  subject: string;
  items: Item[];
  note: string;
  status: "draft" | "issued";
  updatedAt: string;
};
type Business = {
  entityType: EntityType;
  name: string;
  tradeName: string;
  companyName: string;
  representative: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
  registrationNumber: string;
  bank?: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  accountHolder: string;
  stampMode: "auto" | "image";
  stampImage: string;
};

const today = new Date().toISOString().slice(0, 10);
const plusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const uid = () => crypto.randomUUID();
const yen = (value: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(value);
const emptyItem = (): Item => ({ id: uid(), name: "", quantity: 1, unitPrice: 0, taxRate: 10, taxMode: "exclusive" });
const defaultBusiness: Business = {
  entityType: "corporate",
  name: "山田デザイン事務所",
  tradeName: "",
  companyName: "山田デザイン事務所",
  representative: "山田 太郎",
  postalCode: "〒100-0001",
  address: "東京都千代田区千代田1-1",
  phone: "03-1234-5678",
  email: "hello@example.jp",
  registrationNumber: "",
  bank: "〇〇銀行 本店 普通 1234567 ヤマダ タロウ",
  bankName: "",
  branchName: "",
  accountNumber: "",
  accountHolder: "",
  stampMode: "auto",
  stampImage: "",
};
const initialClients: Client[] = [
  { id: "sample-client", entityType: "corporate", name: "株式会社サンプル", honorific: "御中", postalCode: "〒150-0001", address: "東京都渋谷区神宮前1-2-3", contact: "田中様" },
];

function load<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function persist<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}
function newInvoice(sequence: number): Invoice {
  return {
    id: uid(), number: `INV-${new Date().getFullYear()}-${String(sequence).padStart(4, "0")}`,
    clientId: "sample-client", issuerType: "corporate", issueDate: today, dueDate: plusDays(30), subject: "",
    items: [emptyItem()], note: "お振込手数料は貴社にてご負担くださいますようお願いいたします。",
    status: "draft", updatedAt: new Date().toISOString(),
  };
}

function totals(invoice: Invoice) {
  return calculateInvoiceTotals(invoice.items);
}

function Stamp({ business }: { business: Business }) {
  if (business.stampMode === "image" && business.stampImage) return <img className="stamp-image" src={business.stampImage} alt="登録印影" />;
  const label = business.representative.replace(/\s/g, "").slice(0, 4) || "印";
  return <div className="auto-stamp"><span>{label}</span></div>;
}

function App() {
  const [view, setView] = useState<"dashboard" | "invoices" | "clients" | "settings" | "editor">("dashboard");
  const [clients, setClients] = useState<Client[]>(() => load<Client[]>("smart-invoice.clients", initialClients).map((client) => ({ ...client, entityType: client.entityType ?? "corporate" })));
  const [invoices, setInvoices] = useState<Invoice[]>(() => load("smart-invoice.invoices", []));
  const [business, setBusiness] = useState<Business>(() => {
    const saved = load<Partial<Business>>("smart-invoice.business", {});
    const legacyName = saved.name ?? defaultBusiness.name;
    return {
      ...defaultBusiness,
      ...saved,
      tradeName: saved.tradeName ?? (saved.entityType === "individual" ? legacyName : ""),
      companyName: saved.companyName ?? (saved.entityType === "individual" ? "" : legacyName),
    };
  });
  const [editing, setEditing] = useState<Invoice>(() => newInvoice(1));
  const [toast, setToast] = useState("");
  const [exporting, setExporting] = useState(false);
  const invoiceRef = useRef<HTMLDivElement>(null);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const saveClients = (next: Client[]) => { setClients(next); persist("smart-invoice.clients", next); };
  const saveBusiness = (next: Business) => { setBusiness(next); persist("smart-invoice.business", next); };
  const saveInvoice = (status: Invoice["status"] = editing.status) => {
    const saved = { ...editing, status, updatedAt: new Date().toISOString() };
    const next = [saved, ...invoices.filter((invoice) => invoice.id !== saved.id)];
    setEditing(saved); setInvoices(next); persist("smart-invoice.invoices", next);
    notify(status === "issued" ? "請求書を発行済みにしました" : "下書きを保存しました");
    return saved;
  };
  const startNew = () => { setEditing(newInvoice(invoices.length + 1)); setView("editor"); };
  const openInvoice = (invoice: Invoice) => { setEditing({ ...structuredClone(invoice), issuerType: invoice.issuerType ?? business.entityType ?? "corporate", items: invoice.items.map((item) => ({ ...item, taxMode: item.taxMode ?? "exclusive" })) }); setView("editor"); };
  const updateItem = (id: string, patch: Partial<Item>) => setEditing((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) }));

  const exportPdf = async () => {
    if (!invoiceRef.current) return;
    const filePath = await save({
      title: "請求書PDFを保存",
      defaultPath: `${editing.number}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!filePath) return;
    const invoiceElement = invoiceRef.current;
    setExporting(true);
    try {
      saveInvoice("issued");
      invoiceElement.classList.add("pdf-capture");
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const canvas = await html2canvas(invoiceElement, { scale: 3, backgroundColor: "#ffffff", useCORS: true });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const width = 210;
      const height = canvas.height * width / canvas.width;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, Math.min(height, 297));
      await writeFile(filePath, new Uint8Array(pdf.output("arraybuffer")));
      notify("PDFを保存しました");
      const shouldReveal = await confirm("PDFを保存しました。保存先フォルダを開きますか？", {
        title: "Smart Invoice",
        kind: "info",
        okLabel: "フォルダを開く",
        cancelLabel: "閉じる",
      });
      if (shouldReveal) await revealItemInDir(filePath);
    } catch (error) {
      console.error(error); notify("PDFの作成に失敗しました");
    } finally { invoiceElement.classList.remove("pdf-capture"); setExporting(false); }
  };

  const nav = [
    ["dashboard", LayoutDashboard, "ホーム"], ["invoices", History, "請求書"],
    ["clients", Users, "顧客"], ["settings", Settings, "設定"],
  ] as const;
  const selectedClient = clients.find((client) => client.id === editing.clientId);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><div><strong>Smart Invoice</strong><span>かんたん請求書</span></div></div>
      <nav>{nav.map(([key, Icon, label]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}><Icon size={19}/>{label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-badge"><CheckCircle2 size={16}/><span>データはこのPC内に<br/>安全に保存されます</span></div><small>Smart Invoice v0.1.0</small></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><span className="eyebrow">{view === "editor" ? "請求書の編集" : "SMART INVOICE"}</span><h1>{view === "dashboard" ? "ホーム" : view === "invoices" ? "請求書一覧" : view === "clients" ? "顧客管理" : view === "settings" ? "事業者設定" : editing.number}</h1></div>{view !== "editor" && <button className="primary" onClick={startNew}><Plus size={18}/>請求書を作成</button>}</header>

      {view === "dashboard" && <section className="page dashboard">
        <div className="welcome"><div><span className="pill">ローカル保存</span><h2>請求書づくりを、<br/><em>もっとシンプルに。</em></h2><p>顧客と明細を選ぶだけ。税計算から印影入りPDFまで、<br/>このアプリひとつで完結します。</p><button className="primary large" onClick={startNew}><FilePlus2 size={20}/>新しい請求書を作る<ChevronRight size={18}/></button></div><div className="hero-paper"><div className="mini-lines"><b>INVOICE</b><i/><i/><i/></div><div className="hero-stamp">請求<br/>之印</div></div></div>
        <div className="stat-grid"><article><span>発行済み</span><strong>{invoices.filter((i) => i.status === "issued").length}<small>件</small></strong><p>PDF出力した請求書</p></article><article><span>下書き</span><strong>{invoices.filter((i) => i.status === "draft").length}<small>件</small></strong><p>編集中の請求書</p></article><article><span>今月の請求額</span><strong>{yen(invoices.filter((i) => i.status === "issued" && i.issueDate.slice(0, 7) === today.slice(0, 7)).reduce((sum, i) => sum + totals(i).total, 0))}</strong><p>税込合計</p></article></div>
        <div className="panel recent"><div className="panel-title"><div><span className="eyebrow">RECENT</span><h3>最近の請求書</h3></div><button className="text-button" onClick={() => setView("invoices")}>すべて見る<ChevronRight size={16}/></button></div>{invoices.length ? invoices.slice(0, 4).map((i) => <button className="history-row" key={i.id} onClick={() => openInvoice(i)}><div><strong>{i.number}</strong><span>{clients.find((c) => c.id === i.clientId)?.name || "顧客未設定"}</span></div><b>{yen(totals(i).total)}</b><span className={`status ${i.status}`}>{i.status === "issued" ? "発行済み" : "下書き"}</span><ChevronRight size={17}/></button>) : <div className="empty"><FilePlus2 size={30}/><p>まだ請求書がありません</p><span>最初の請求書を作成してみましょう</span></div>}</div>
      </section>}

      {view === "invoices" && <section className="page"><div className="panel table-panel">{invoices.length ? invoices.map((i) => <button className="history-row" key={i.id} onClick={() => openInvoice(i)}><div><strong>{i.number}</strong><span>{clients.find((c) => c.id === i.clientId)?.name || "顧客未設定"} ・ {i.issueDate}</span></div><b>{yen(totals(i).total)}</b><span className={`status ${i.status}`}>{i.status === "issued" ? "発行済み" : "下書き"}</span><ChevronRight size={17}/></button>) : <div className="empty tall"><History size={34}/><p>請求書はまだありません</p><button className="primary" onClick={startNew}>最初の請求書を作る</button></div>}</div></section>}

      {view === "clients" && <ClientsPage clients={clients} onChange={saveClients}/>} 
      {view === "settings" && <SettingsPage business={business} onChange={saveBusiness} notify={notify}/>} 

      {view === "editor" && <section className="editor-page">
        <div className="editor-actions"><button className="secondary" onClick={() => { saveInvoice(); setView("invoices"); }}><Save size={17}/>下書き保存</button><button className="primary" onClick={exportPdf} disabled={exporting}><FileDown size={18}/>{exporting ? "PDF作成中…" : "PDFを発行"}</button></div>
        <div className="editor-layout">
          <div className="form-stack">
            <div className="form-card"><h3><span>1</span>基本情報</h3><label className="issuer-type-label">請求元の発行形態</label><div className="entity-choice invoice-entity"><button className={editing.issuerType === "individual" ? "active" : ""} onClick={() => setEditing({...editing, issuerType: "individual"})}>個人として発行</button><button className={editing.issuerType === "corporate" ? "active" : ""} onClick={() => setEditing({...editing, issuerType: "corporate"})}>法人として発行</button></div><div className="form-grid"><label>請求書番号<input value={editing.number} onChange={(e) => setEditing({...editing, number: e.target.value})}/></label><label>発行日<input type="date" value={editing.issueDate} onChange={(e) => setEditing({...editing, issueDate: e.target.value})}/></label><label>請求先<select value={editing.clientId} onChange={(e) => setEditing({...editing, clientId: e.target.value})}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.entityType === "individual" ? "個人" : "法人"}）</option>)}</select></label><label>支払期限<input type="date" value={editing.dueDate} onChange={(e) => setEditing({...editing, dueDate: e.target.value})}/></label><label className="wide">件名<input placeholder="例：Webサイト制作費" value={editing.subject} onChange={(e) => setEditing({...editing, subject: e.target.value})}/></label></div></div>
            <div className="form-card"><div className="card-heading"><h3><span>2</span>明細</h3><button className="text-button" onClick={() => setEditing({...editing, items: [...editing.items, emptyItem()]})}><Plus size={16}/>行を追加</button></div>{editing.items.map((item, index) => <div className="item-row" key={item.id}><span>{index + 1}</span><input className="item-name" placeholder="品目・サービス名" value={item.name} onChange={(e) => updateItem(item.id, {name: e.target.value})}/><input type="number" min="0" value={item.quantity} onChange={(e) => updateItem(item.id, {quantity: Number(e.target.value)})}/><input type="number" min="0" value={item.unitPrice} onChange={(e) => updateItem(item.id, {unitPrice: Number(e.target.value)})}/><select value={item.taxRate} onChange={(e) => updateItem(item.id, {taxRate: Number(e.target.value) as TaxRate})}><option value="10">10%</option><option value="8">8%</option><option value="0">非課税</option></select><select value={item.taxMode ?? "exclusive"} disabled={item.taxRate === 0} onChange={(e) => updateItem(item.id, {taxMode: e.target.value as TaxMode})}><option value="exclusive">外税</option><option value="inclusive">内税</option></select><button className="icon-button danger" disabled={editing.items.length === 1} onClick={() => setEditing({...editing, items: editing.items.filter((i) => i.id !== item.id)})}><Trash2 size={16}/></button></div>)}<div className="item-labels"><span>品目</span><span>数量</span><span>単価</span><span>税率</span><span>税方式</span></div></div>
            <div className="form-card"><h3><span>3</span>備考</h3><textarea rows={3} value={editing.note} onChange={(e) => setEditing({...editing, note: e.target.value})}/></div>
          </div>
          <div className="preview-wrap"><span className="preview-label">PDF プレビュー</span><InvoicePreview invoice={editing} client={selectedClient} business={business} invoiceRef={invoiceRef}/></div>
        </div>
      </section>}
    </main>
    {toast && <div className="toast"><CheckCircle2 size={18}/>{toast}</div>}
  </div>;
}

function InvoicePreview({ invoice, client, business, invoiceRef }: { invoice: Invoice; client?: Client; business: Business; invoiceRef: React.RefObject<HTMLDivElement | null> }) {
  const sum = totals(invoice);
  const structuredBank = [
    business.bankName && `金融機関：${business.bankName}`,
    business.branchName && `支店：${business.branchName}`,
    business.accountNumber && `口座番号：${business.accountNumber}`,
    business.accountHolder && `名義：${business.accountHolder}`,
  ].filter(Boolean).join("\n");
  return <div className="invoice-paper" ref={invoiceRef}>
    <div className="invoice-head"><div><h2>請求書</h2></div><div className="invoice-meta"><b>{invoice.number}</b><span>発行日：{invoice.issueDate}</span></div></div>
    <div className="invoice-parties"><div className="recipient"><h3>{client?.name || "請求先を選択"} <small>{client?.entityType === "individual" ? "様" : "御中"}</small></h3><span>{client?.postalCode}</span><span>{client?.address}</span>{client?.entityType === "corporate" && client.contact && <span>{client.contact}</span>}</div><div className="issuer"><strong>{invoice.issuerType === "individual" ? business.representative : business.companyName}</strong>{invoice.issuerType === "individual" ? business.tradeName && <span>屋号 {business.tradeName}</span> : business.representative && <span>代表 {business.representative}</span>}<span>{business.postalCode}</span><span>{business.address}</span><span>TEL {business.phone}</span><span>{business.email}</span>{business.registrationNumber && <span>登録番号 {business.registrationNumber}</span>}<Stamp business={business}/></div></div>
    <p className="greeting">下記のとおりご請求申し上げます。</p>{invoice.subject && <p className="subject">件名：{invoice.subject}</p>}
    <div className="amount-box"><span>ご請求金額（税込）</span><strong>{yen(sum.total)}</strong><small>お支払期限　{invoice.dueDate}</small></div>
    <table><thead><tr><th>品目・サービス</th><th>数量</th><th>単価（税抜）</th><th>税率</th><th>金額（税抜）</th></tr></thead><tbody>{invoice.items.map((item) => { const line = calculateLineAmounts(item); const netUnitPrice = item.quantity > 0 ? Math.ceil(line.net / item.quantity) : 0; return <tr key={item.id}><td>{item.name || "（品目未入力）"}</td><td>{item.quantity}</td><td>{yen(netUnitPrice)}</td><td>{item.taxRate ? `${item.taxRate}%` : "非課税"}</td><td>{yen(line.net)}</td></tr>; })}</tbody></table>
    <div className="summary"><div/><dl><div><dt>小計</dt><dd>{yen(sum.subtotal)}</dd></div>{sum.tax8 > 0 && <div><dt>消費税（8%）</dt><dd>{yen(sum.tax8)}</dd></div>}<div><dt>消費税（10%）</dt><dd>{yen(sum.tax10)}</dd></div><div className="grand"><dt>合計</dt><dd>{yen(sum.total)}</dd></div></dl></div>
    <div className="invoice-footer"><div><b>振込先</b><p>{structuredBank || business.bank || "振込先を設定してください"}</p></div><div><b>備考</b><p>{invoice.note}</p></div></div>
  </div>;
}

function ClientsPage({ clients, onChange }: { clients: Client[]; onChange: (clients: Client[]) => void }) {
  const [draft, setDraft] = useState<Client | null>(null);
  const save = () => { if (!draft?.name.trim()) return; onChange([draft, ...clients.filter((c) => c.id !== draft.id)]); setDraft(null); };
  const selectType = (entityType: EntityType) => draft && setDraft({ ...draft, entityType, honorific: entityType === "individual" ? "様" : "御中" });
  return <section className="page">
    <div className="panel">
      <div className="panel-title"><div><span className="eyebrow">CLIENTS</span><h3>登録顧客</h3></div><button className="primary" onClick={() => setDraft({id: uid(), entityType: "corporate", name: "", honorific: "御中", postalCode: "", address: "", contact: ""})}><Plus size={17}/>顧客を追加</button></div>
      <div className="client-grid">{clients.map((client) => <button className="client-card" key={client.id} onClick={() => setDraft({...client, entityType: client.entityType ?? "corporate"})}><div className="client-icon"><Building2 size={20}/></div><div><strong>{client.name} {client.entityType === "individual" ? "様" : "御中"}</strong><span><b className="entity-badge">{client.entityType === "individual" ? "個人" : "法人"}</b>{client.address || "住所未登録"}</span>{client.entityType === "corporate" && <small>{client.contact}</small>}</div><ChevronRight size={17}/></button>)}</div>
    </div>
    {draft && <div className="modal-backdrop"><div className="modal">
      <button className="modal-close" onClick={() => setDraft(null)}><X/></button><span className="eyebrow">CLIENT</span><h2>顧客情報</h2>
      <div className="entity-choice"><button className={draft.entityType === "individual" ? "active" : ""} onClick={() => selectType("individual")}>個人</button><button className={draft.entityType === "corporate" ? "active" : ""} onClick={() => selectType("corporate")}>法人</button></div>
      <div className="form-grid"><label className="wide">{draft.entityType === "individual" ? "氏名" : "会社名"}<input autoFocus value={draft.name} onChange={(e) => setDraft({...draft, name: e.target.value})}/></label><label>敬称<input value={draft.entityType === "individual" ? "様" : "御中"} disabled/></label><label>郵便番号<input value={draft.postalCode} onChange={(e) => setDraft({...draft, postalCode: e.target.value})}/></label><label className="wide">住所<input value={draft.address} onChange={(e) => setDraft({...draft, address: e.target.value})}/></label>{draft.entityType === "corporate" && <label className="wide">部署・担当者<input value={draft.contact} onChange={(e) => setDraft({...draft, contact: e.target.value})}/></label>}</div>
      <div className="modal-actions">{clients.some((c) => c.id === draft.id) && <button className="danger-link" onClick={() => { onChange(clients.filter((c) => c.id !== draft.id)); setDraft(null); }}><Trash2 size={16}/>削除</button>}<button className="primary" onClick={save}><Save size={17}/>保存</button></div>
    </div></div>}
  </section>;
}

function SettingsPage({ business, onChange, notify }: { business: Business; onChange: (business: Business) => void; notify: (s: string) => void }) {
  const [draft, setDraft] = useState(business);
  const upload = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setDraft({...draft, stampImage: String(reader.result), stampMode: "image"}); reader.readAsDataURL(file); };
  return <section className="page settings-grid">
    <div className="panel form-card settings-card"><span className="eyebrow">BUSINESS</span><h2>請求元情報</h2>
      <p className="settings-help">会社名と屋号は別々に登録できます。個人として発行する場合、屋号は任意です。</p>
      <div className="form-grid"><label className="wide">会社名<input value={draft.companyName} onChange={(e) => setDraft({...draft, companyName: e.target.value})}/></label><label>氏名・代表者名<input value={draft.representative} onChange={(e) => setDraft({...draft, representative: e.target.value})}/></label><label>屋号（任意）<input placeholder="個人で屋号がある場合のみ" value={draft.tradeName} onChange={(e) => setDraft({...draft, tradeName: e.target.value})}/></label><label>郵便番号<input value={draft.postalCode} onChange={(e) => setDraft({...draft, postalCode: e.target.value})}/></label><label className="wide">住所<input value={draft.address} onChange={(e) => setDraft({...draft, address: e.target.value})}/></label><label>電話番号<input value={draft.phone} onChange={(e) => setDraft({...draft, phone: e.target.value})}/></label><label>メールアドレス<input value={draft.email} onChange={(e) => setDraft({...draft, email: e.target.value})}/></label><label className="wide">適格請求書発行事業者 登録番号<input placeholder="T1234567890123" value={draft.registrationNumber} onChange={(e) => setDraft({...draft, registrationNumber: e.target.value})}/></label><div className="wide bank-fields"><strong>振込先</strong><div className="form-grid"><label>金融機関<input placeholder="三井住友銀行" value={draft.bankName} onChange={(e) => setDraft({...draft, bankName: e.target.value})}/></label><label>支店<input placeholder="本店営業部" value={draft.branchName} onChange={(e) => setDraft({...draft, branchName: e.target.value})}/></label><label>口座番号<input placeholder="普通 1234567" value={draft.accountNumber} onChange={(e) => setDraft({...draft, accountNumber: e.target.value})}/></label><label>名義<input placeholder="ヤマダ タロウ" value={draft.accountHolder} onChange={(e) => setDraft({...draft, accountHolder: e.target.value})}/></label></div></div></div>
    </div>
    <div className="panel stamp-settings"><span className="eyebrow">STAMP</span><h2>印鑑プレビュー</h2><p>代表者名から印影を自動生成するか、お手持ちのPNG画像を登録できます。</p><div className="stamp-preview"><Stamp business={draft}/></div><div className="segment"><button className={draft.stampMode === "auto" ? "active" : ""} onClick={() => setDraft({...draft, stampMode: "auto"})}>自動生成</button><button className={draft.stampMode === "image" ? "active" : ""} disabled={!draft.stampImage} onClick={() => setDraft({...draft, stampMode: "image"})}>登録画像</button></div><label className="upload-button">PNG画像を選ぶ<input type="file" accept="image/png,image/jpeg" onChange={upload}/></label><button className="primary full" onClick={() => { onChange(draft); notify("事業者設定を保存しました"); }}><Save size={17}/>設定を保存</button><small className="legal-note">この印影は請求書上の表示用です。電子署名や本人認証の機能はありません。</small></div>
  </section>;
}

export default App;
