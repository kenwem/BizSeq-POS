import React from 'react';
import { formatCurrency } from '../../lib/utils';

interface PrintableReceiptProps {
  sale: any;
  format: '58mm' | '80mm' | 'standard';
  profile: any;
}

export const PrintableReceipt: React.FC<PrintableReceiptProps> = ({ sale, format, profile }) => {
  if (!sale) return null;

  const storeName = profile?.store?.name || profile?.storeName || 'Store';
  const storeAddress = profile?.store?.storeAddress || profile?.storeAddress || '';
  const storePhone = profile?.store?.storePhone || profile?.storePhone || '';
  const receiptHeader = profile?.store?.receiptHeader || profile?.receiptHeader || '';
  const receiptFooter = profile?.store?.receiptFooter || profile?.receiptFooter || '';
  
  const cashierName = sale.cashierName || profile?.username || 'Unknown Cashier';
  const saleId = String(sale.id || '').substring(0, 8).toUpperCase();
  
  // Format dates robustly
  let dateStr = '';
  if (sale.createdAt) {
    if (sale.createdAt.toDate) {
      dateStr = sale.createdAt.toDate().toLocaleString();
    } else if (sale.createdAt instanceof Date) {
      dateStr = sale.createdAt.toLocaleString();
    } else {
      dateStr = new Date(sale.createdAt).toLocaleString();
    }
  } else {
    dateStr = new Date().toLocaleString();
  }

  const paymentMethodName = String(sale.paymentMethod || 'cash').toUpperCase();

  let splitPaymentInfo = null;
  if (sale.paymentMethod === 'split' && sale.splitPayments) {
    splitPaymentInfo = sale.splitPayments.map((p: any, idx: number) => (
      <div key={idx} className="flex justify-between text-[11px] font-mono pl-3" style={{ paddingLeft: '8px' }}>
        <span>• {String(p.method).toUpperCase()}:</span>
        <span className="font-bold">{formatCurrency(p.amount)}</span>
      </div>
    ));
  }

  if (format === '58mm') {
    return (
      <div className="w-[58mm] max-w-[58mm] font-mono text-[10px] text-black bg-white p-1 leading-tight tracking-tight">
        <div className="text-center font-bold text-xs uppercase mb-0.5">{storeName}</div>
        {storeAddress && <div className="text-center text-[7.5px] uppercase mb-0.5">{storeAddress}</div>}
        {storePhone && <div className="text-center text-[7.5px] mb-0.5">TEL: {storePhone}</div>}
        {receiptHeader && <div className="text-center text-[7.5px] italic mb-1 border-b border-dotted border-black pb-1">{receiptHeader}</div>}
        <div className="text-center text-[8px] uppercase tracking-wider mb-2">Receipt: INV-{saleId}</div>
        
        <div className="border-b border-dashed border-black pb-1 mb-1 text-[8px] space-y-0.5">
          <div className="flex justify-between"><span>Date:</span><span>{dateStr}</span></div>
          <div className="flex justify-between"><span>Cashier:</span><span>{cashierName}</span></div>
          <div className="flex justify-between"><span>Pay:</span><span className="font-bold">{paymentMethodName}</span></div>
          {splitPaymentInfo}
        </div>

        <table className="w-full text-left border-collapse mb-1">
          <thead>
            <tr className="border-b border-dashed border-black text-[8px]">
              <th className="font-bold py-1">ITEM</th>
              <th className="font-bold py-1 text-right">TOT</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item: any, i: number) => (
              <tr key={i} className="border-b border-dashed border-slate-100 text-[9px]">
                <td className="py-1 vertical-align-top">
                  <div className="font-bold uppercase text-[9px]">{item.name}</div>
                  <div className="text-[8px] text-zinc-600">{item.quantity} x {formatCurrency(item.price)}</div>
                </td>
                <td className="py-1 text-right font-bold text-[9px] vertical-align-top">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-dashed border-black pt-1 space-y-0.5 text-[9px]">
          <div className="flex justify-between"><span>SUB:</span><span>{formatCurrency(sale.subtotal || sale.total)}</span></div>
          {sale.discount ? <div className="flex justify-between"><span>DISC:</span><span>-{formatCurrency(sale.discount)}</span></div> : null}
          <div className="flex justify-between font-bold text-[11px] border-t border-dashed border-black pt-1">
            <span>DUE NGN:</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
        </div>

        <div className="text-center text-[8px] mt-4 pt-1 border-t border-dashed border-black">
          {receiptFooter ? (
            <div className="uppercase font-bold whitespace-pre-wrap">{receiptFooter}</div>
          ) : (
            <div>THANK YOU FOR YOUR PATRONAGE!</div>
          )}
          <div className="text-[7px] mt-1 text-zinc-500">Powered by BizSeq</div>
        </div>
      </div>
    );
  }

  if (format === '80mm') {
    return (
      <div className="w-[80mm] max-w-[80mm] font-mono text-xs text-black bg-white p-3 leading-tight">
        <div className="text-center font-black text-sm uppercase mb-1">{storeName}</div>
        {storeAddress && <div className="text-center text-[10px] text-zinc-600 uppercase mb-0.5">{storeAddress}</div>}
        {storePhone && <div className="text-center text-[10px] text-zinc-600 mb-0.5">TEL: {storePhone}</div>}
        {receiptHeader && <div className="text-center text-[9px] italic text-zinc-500 my-1 pb-1 border-b border-dotted border-zinc-200">{receiptHeader}</div>}
        <div className="text-center text-[10px] uppercase tracking-widest text-zinc-500 mb-3">OFFICIAL RECEIPT</div>
        
        <div className="border-y-2 border-dashed border-black py-2 mb-3 space-y-1">
          <div className="flex justify-between"><span>Receipt No:</span><span className="font-bold">INV-{saleId}</span></div>
          <div className="flex justify-between"><span>Date:</span><span>{dateStr}</span></div>
          <div className="flex justify-between"><span>Cashier:</span><span>{cashierName}</span></div>
          <div className="flex justify-between"><span>Payment Method:</span><span className="font-bold">{paymentMethodName}</span></div>
          {splitPaymentInfo}
        </div>

        <table className="w-full text-left mb-3">
          <thead>
            <tr className="border-b-2 border-dashed border-black">
              <th className="font-bold py-1">Description</th>
              <th className="font-bold py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item: any, i: number) => (
              <tr key={i} className="border-b border-dashed border-zinc-200">
                <td className="py-1.5 align-top">
                  <div className="font-bold uppercase">{item.name}</div>
                  <div className="text-[10px] text-zinc-500">{item.quantity} x {formatCurrency(item.price)} {item.unitName ? `(${item.unitName})` : ''}</div>
                </td>
                <td className="py-1.5 text-right font-bold align-top">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t-2 border-dashed border-black pt-2 space-y-1">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(sale.subtotal || sale.total)}</span></div>
          {sale.discount ? <div className="flex justify-between"><span>Discount:</span><span>-{formatCurrency(sale.discount)}</span></div> : null}
          <div className="flex justify-between text-sm font-black border-t-2 border-dashed border-black pt-2">
            <span>TOTAL DUE:</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
        </div>

        <div className="text-center text-[10px] mt-6 pt-3 border-t border-dashed border-black space-y-1">
          {receiptFooter ? (
            <p className="font-bold uppercase whitespace-pre-wrap">{receiptFooter}</p>
          ) : (
            <p className="font-bold">Thank You For Your Patronage!</p>
          )}
          <p className="text-[9px] text-zinc-400">Powered by BizSeq</p>
        </div>
      </div>
    );
  }

  // Standard A4 Invoice / Report Format
  return (
    <div className="w-[210mm] max-w-full font-sans text-slate-800 bg-white p-12 mx-auto leading-normal">
      <div className="flex justify-between items-start border-b-2 border-slate-100 pb-8 mb-8">
        <div>
          <h1 className="text-3xl font-black text-blue-900 tracking-tight uppercase mb-1">{storeName}</h1>
          {storeAddress && <p className="text-sm text-slate-600 font-semibold">{storeAddress}</p>}
          {storePhone && <p className="text-sm text-slate-500">Tel: {storePhone}</p>}
          {receiptHeader && <p className="text-xs text-slate-400 italic mb-3">{receiptHeader}</p>}
          <p className="text-xs text-slate-400 uppercase tracking-widest mt-1">Official Cloud Invoice</p>
          <div className="mt-4 text-sm text-slate-500 space-y-0.5">
            <p className="font-bold">Store Register Unit</p>
            <p>ID: {profile?.storeId || 'BIZSEQ-TERMINAL'}</p>
          </div>
        </div>
        <div className="text-right">
          <span className="px-4 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-black uppercase rounded-full border border-emerald-100">Sale Paid</span>
          <div className="mt-6 space-y-1 text-sm">
            <p className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Invoice / Bill Number</p>
            <p className="font-mono text-lg font-black text-slate-900">INV-{saleId}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8 text-sm">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Billing Details</p>
          <div className="bg-slate-50 rounded-2xl p-4 text-slate-600 space-y-1.5">
            <p className="font-bold text-slate-900">POS Register Customer</p>
            <p>Cash Sale Registry</p>
            <p className="text-xs text-slate-400 mt-2">Cashier: {cashierName}</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Transaction Metadata</p>
          <div className="bg-slate-50 rounded-2xl p-4 text-slate-600 space-y-1.5">
            <div className="flex justify-between"><span>Transaction Time:</span><span className="font-mono text-slate-900 font-bold">{dateStr}</span></div>
            <div className="flex justify-between"><span>Payment Mode:</span><span className="font-mono text-slate-900 font-bold uppercase">{paymentMethodName}</span></div>
            <div className="flex justify-between"><span>System Status:</span><span className="text-blue-600 font-bold">Synchronized</span></div>
          </div>
        </div>
      </div>

      {sale.paymentMethod === 'split' && sale.splitPayments && (
        <div className="mb-6 p-4 bg-slate-50 rounded-2xl">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Split Payments Summary</p>
          <div className="grid grid-cols-2 gap-4 text-xs font-bold text-slate-700">
            {sale.splitPayments.map((p: any, idx: number) => (
              <div key={idx} className="flex justify-between py-1 border-b border-dashed border-slate-200">
                <span className="capitalize">{p.method}:</span>
                <span className="font-mono">{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <table className="w-full text-left border-collapse mb-8 text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 bg-slate-50">
            <th className="p-3 font-bold text-slate-500 uppercase text-[10px]">Item description</th>
            <th className="p-3 font-bold text-slate-500 uppercase text-[10px] text-right">Quantity</th>
            <th className="p-3 font-bold text-slate-500 uppercase text-[10px] text-right">Unit Price</th>
            <th className="p-3 font-bold text-slate-500 uppercase text-[10px] text-right">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item: any, i: number) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
              <td className="p-3 font-bold text-slate-900">
                {item.name}
                {item.unitName && <span className="ml-2 text-xs font-normal text-slate-400">({item.unitName})</span>}
              </td>
              <td className="p-3 text-right text-slate-600 font-mono">{item.quantity}</td>
              <td className="p-3 text-right text-slate-600 font-mono">{formatCurrency(item.price)}</td>
              <td className="p-3 text-right font-bold text-slate-900 font-mono">{formatCurrency(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-12">
        <div className="w-80 space-y-2 text-sm text-slate-600">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span className="font-mono font-bold text-slate-900">{formatCurrency(sale.subtotal || sale.total)}</span>
          </div>
          {sale.discount ? (
            <div className="flex justify-between text-rose-600">
              <span>Promo / Discount:</span>
              <span className="font-mono font-bold">-{formatCurrency(sale.discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-black text-slate-950">
            <span>TOTAL AMOUNT:</span>
            <span className="font-mono text-blue-900 italic">{formatCurrency(sale.total)}</span>
          </div>
        </div>
      </div>

      <div className="border-t-2 border-slate-100 pt-8 text-center text-xs text-slate-400 space-y-2">
        {receiptFooter ? (
          <p className="font-bold text-slate-500 uppercase tracking-widest whitespace-pre-wrap">{receiptFooter}</p>
        ) : (
          <>
            <p className="font-bold text-slate-500 uppercase tracking-widest">Thank You For Your Valued Business!</p>
            <p>If you have any questions or require an electronic bank copy of this transaction, please do not hesitate to contact our store executive.</p>
          </>
        )}
        <p className="font-bold text-blue-900 mt-4">Powered by BizSeq</p>
      </div>
    </div>
  );
};
