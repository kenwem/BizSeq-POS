import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Product, Sale } from '../types';
import { formatCurrency } from './utils';

// Extend jsPDF with autotable type
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export const exportProductsToExcel = (products: Product[], fileName = 'inventory_export') => {
  const data = products.map(p => ({
    'ID': p.id,
    'Name': p.name,
    'Barcode': p.barcode,
    'SKU': p.sku || '',
    'Category': p.category,
    'Price': p.price,
    'Cost': p.cost || 0,
    'Stock': p.stock,
    'Stock Value': (p.stock * p.price).toFixed(2),
    'Variation': p.units && p.units.length > 0 ? p.units.map(u => u.name).join(', ') : '',
    'Variation Price': p.units && p.units.length > 0 ? p.units.map(u => u.price).join(', ') : ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

export const exportProductsToPDF = (products: Product[], storeName: string) => {
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.text('Inventory Report', 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Store: ${storeName}`, 14, 30);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 36);

  const tableData = products.map(p => [
    p.name,
    p.barcode,
    p.category,
    formatCurrency(p.price),
    p.stock.toString(),
    formatCurrency(p.stock * p.price)
  ]);

  doc.autoTable({
    startY: 45,
    head: [['Name', 'Barcode', 'Category', 'Price', 'Stock', 'Total Value']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [5, 150, 105] }
  });

  doc.save(`inventory_report_${Date.now()}.pdf`);
};

export const exportSalesToExcel = (sales: Sale[], fileName = 'sales_export') => {
  const data = sales.map(s => ({
    'Date': new Date(s.createdAt?.seconds * 1000 || s.createdAt).toLocaleString(),
    'Items': s.items.map(i => `${i.name} (${i.quantity})`).join(', '),
    'Subtotal': s.subtotal,
    'Discount': s.discount,
    'Total': s.total,
    'Payment': s.paymentMethod,
    'Cashier': s.cashierName
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sales');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};
