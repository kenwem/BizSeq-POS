/**
 * Web Bluetooth ESC/POS Thermal Printer Service
 * Supports 58mm (32 characters) and 80mm (48 characters) bluetooth printers.
 * Built with safety mechanisms for cheap mobile printers:
 * - Chunked byte streaming (20-byte buffers) to prevent buffer overflow.
 * - Minimal raw control sequences to dodge garbled symbol printing.
 * - Multi-signature GATT UUID filters for extensive brand capability out of the box.
 */

export class WebBluetoothPrinterService {
  private device: any = null;
  private characteristic: any = null;
  private connectedDeviceName: string = '';

  // Common serial service/printer UUIDs
  private static readonly SERVICE_UUIDS = [
    '0000ffe0-0000-1000-8000-00805f9b34fb', // Very common cheap printer service
    'ffe0',
    '18f0', // Standard generic printer GATT
    '000018f0-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-41ae-8fad-54f30f92f067', // ISSC Bluetooth custom service
    '00001101-0000-1000-8000-00805f9b34fb'  // Classic SPP over BLE wrapper
  ];

  isSupported(): boolean {
    return typeof window !== 'undefined' && !!(navigator as any).bluetooth;
  }

  async isConnected(): Promise<boolean> {
    return !!this.device && !!this.device.gatt.connected && !!this.characteristic;
  }

  getConnectedDeviceName(): string {
    return this.connectedDeviceName || (this.device ? this.device.name : '');
  }

  /**
   * Triggers the browser's Bluetooth scanner and establishes a GATT channel connection.
   */
  async connect(): Promise<boolean> {
    if (!this.isSupported()) {
      throw new Error(
        "Web Bluetooth API is not supported in this browser. Please use Chrome, Edge, or Android Chrome."
      );
    }

    try {
      console.log("[BluetoothPrinter] Requesting device...");
      
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: WebBluetoothPrinterService.SERVICE_UUIDS
      });

      console.log(`[BluetoothPrinter] Selected device: ${device.name}`);
      this.device = device;
      this.connectedDeviceName = device.name || 'Bluetooth Printer';

      // Watch for disconnection events
      device.addEventListener('gattserverdisconnected', () => {
        console.warn("[BluetoothPrinter] GATT Server disconnected automatically.");
        this.characteristic = null;
        this.connectedDeviceName = '';
      });

      console.log("[BluetoothPrinter] Connecting to GATT server...");
      const server = await device.gatt.connect();

      console.log("[BluetoothPrinter] Searching primary custom write gateway service...");
      let service: any = null;

      // Iterate over our search indexes
      for (const uuid of WebBluetoothPrinterService.SERVICE_UUIDS) {
        try {
          service = await server.getPrimaryService(uuid);
          console.log(`[BluetoothPrinter] Found service matching GATT signature: ${uuid}`);
          break;
        } catch (_) {
          // Continue probing
        }
      }

      if (!service) {
        // Fallback: fetch any primary services
        try {
          const primaryServices = await server.getPrimaryServices();
          if (primaryServices.length > 0) {
            service = primaryServices[0];
            console.log(`[BluetoothPrinter] No specific service signature matched. Selecting fallback first service: ${service.uuid}`);
          }
        } catch (err) {
          console.error("[BluetoothPrinter] Fallback primary listing failed:", err);
        }
      }

      if (!service) {
        throw new Error(
          "Could not locate a compatible primary service on this printer. Make sure it is paired in your system bluetooth settings first."
        );
      }

      console.log("[BluetoothPrinter] Getting write characteristic...");
      let char: any = null;

      try {
        const characteristics = await service.getCharacteristics();
        // Look for write characteristics
        char = characteristics.find(
          (c: any) => c.properties.write || c.properties.writeWithoutResponse
        );
      } catch (_) {
        // characteristic lookup error
      }

      if (!char) {
        // Fallback to searching standard 0xFFE1 characteristic
        try {
          char = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
        } catch (_) {
          // fail default
        }
      }

      if (!char) {
        throw new Error("Could not find writing characteristics on the printer service.");
      }

      this.characteristic = char;
      console.log("[BluetoothPrinter] Connection initialized perfectly!");
      return true;
    } catch (e: any) {
      console.error("[BluetoothPrinter] Connection flow cataloged failure:", e);
      this.device = null;
      this.characteristic = null;
      this.connectedDeviceName = '';
      throw e;
    }
  }

  /**
   * Streams a binary payload as 20-byte serialized chunk packages to safely prevent buffer overflow.
   */
  async writeBytes(bytes: Uint8Array): Promise<void> {
    if (!this.characteristic) {
      throw new Error("No connected printers. Connect to a device first.");
    }

    const maxChunkSize = 20;
    for (let offset = 0; offset < bytes.length; offset += maxChunkSize) {
      const chunk = bytes.slice(offset, offset + maxChunkSize);
      try {
        if (this.characteristic.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValue(chunk);
        }
      } catch (err) {
        console.error(`[BluetoothPrinter] Chunk transmitting error at index ${offset}:`, err);
        throw err;
      }
      // 15ms queue spacing
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.device && this.device.gatt.connected) {
        await this.device.gatt.disconnect();
      }
    } catch (err) {
      console.error("[BluetoothPrinter] Disconnection errored:", err);
    } finally {
      this.device = null;
      this.characteristic = null;
      this.connectedDeviceName = '';
      console.log("[BluetoothPrinter] Printer disconnected and cleared.");
    }
  }

  /**
   * Helper text layout generator. Produces clean plain receipts aligned to widths.
   */
  private formatReceiptText(sale: any, format: '58mm' | '80mm', profile: any): string {
    const width = format === '58mm' ? 32 : 48;
    const storeName = profile?.store?.name || profile?.storeName || 'BIZSEQ MERCHANDISE';
    const storeAddress = profile?.store?.storeAddress || profile?.storeAddress || '';
    const storePhone = profile?.store?.storePhone || profile?.storePhone || '';
    const receiptHeader = profile?.store?.receiptHeader || profile?.receiptHeader || '';
    const receiptFooter = profile?.store?.receiptFooter || profile?.receiptFooter || '';
    
    const cashierName = sale.cashierName || profile?.username || 'Cashier';
    const saleId = String(sale.id || '').substring(0, 8).toUpperCase();

    // Standardize date
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

    const payMethod = String(sale.paymentMethod || 'CASH').toUpperCase();
    const divider = "-".repeat(width);

    let output = "";

    // Store Name & Metadata Block (Centered)
    output += this.centerText(storeName, width) + "\n";
    if (storeAddress) {
      // Split clean address rows
      const addressLines = this.wrapText(storeAddress, width);
      addressLines.forEach(l => { output += this.centerText(l, width) + "\n"; });
    }
    if (storePhone) {
      output += this.centerText(`TEL: ${storePhone}`, width) + "\n";
    }
    if (receiptHeader) {
      const headerLines = this.wrapText(receiptHeader, width);
      headerLines.forEach(l => { output += this.centerText(l, width) + "\n"; });
    }
    output += divider + "\n";

    // Receipt header data
    output += this.padText("RECEIPT ID:", `INV-${saleId}`, width) + "\n";
    output += this.padText("DATE TRNS:", dateStr, width) + "\n";
    output += this.padText("CASHIER:", cashierName, width) + "\n";
    output += this.padText("PAY BY:", payMethod, width) + "\n";

    if (sale.paymentMethod === 'split' && sale.splitPayments) {
      sale.splitPayments.forEach((p: any) => {
        output += this.padText(` • ${String(p.method).toUpperCase()}:`, `NGN ${Number(p.amount).toLocaleString()}`, width) + "\n";
      });
    }
    output += divider + "\n";

    // List Items with wrapping configurations
    if (format === '58mm') {
      // 58mm compact layout: Row 1 = item name, Row 2 = Qty x Price ... Total
      output += "QTY ITEM PRICE         TOTAL\n";
      output += divider + "\n";
      
      sale.items.forEach((item: any) => {
        // Name on top
        output += item.name.toUpperCase() + "\n";
        // Detailed quantities and results underneath
        const priceStr = Number(item.price).toLocaleString();
        const totalStr = `NGN ${Number(item.total).toLocaleString()}`;
        const qtyDetail = `  ${item.quantity} x ${priceStr}`;
        output += this.padText(qtyDetail, totalStr, width) + "\n";
      });
    } else {
      // 80mm large layout: Standard tabular rows
      output += this.padThreeColumns("ITEM DESCRIPTION", "QTY", "LINE TOTAL", width) + "\n";
      output += divider + "\n";
      
      sale.items.forEach((item: any) => {
        const titleStr = item.name.toUpperCase();
        const qtyStr = `${item.quantity}`;
        const totalStr = `NGN ${Number(item.total).toLocaleString()}`;

        if (titleStr.length <= (width - 18)) {
          // Single-line layout
          output += this.padThreeColumns(titleStr, qtyStr, totalStr, width) + "\n";
        } else {
          // Wrapped item name with action rows below
          output += titleStr + "\n";
          output += this.padThreeColumns("", qtyStr, totalStr, width) + "\n";
        }
      });
    }
    output += divider + "\n";

    // Totals Block
    const sub = sale.subtotal || sale.total;
    output += this.padText("SUBTOTAL:", `NGN ${Number(sub).toLocaleString()}`, width) + "\n";
    if (sale.discount) {
      output += this.padText("PROMO DISCOUNT:", `-NGN ${Number(sale.discount).toLocaleString()}`, width) + "\n";
    }
    output += divider + "\n";
    output += this.padText("TOTAL DUE:", `NGN ${Number(sale.total).toLocaleString()}`, width) + "\n";
    output += divider + "\n\n";

    // Footer lines
    if (receiptFooter) {
      const footerLines = this.wrapText(receiptFooter, width);
      footerLines.forEach(l => { output += this.centerText(l, width) + "\n"; });
    } else {
      output += this.centerText("THANK YOU FOR YOUR PATRONAGE!", width) + "\n";
    }
    output += this.centerText("BizSeq Retail Suite", width) + "\n";
    
    // Spaced lines for thermal cutter gap
    output += "\n\n\n\n\n";
    return output;
  }

  private centerText(text: string, width: number): string {
    if (text.length >= width) return text.substring(0, width);
    const padding = Math.floor((width - text.length) / 2);
    return " ".repeat(padding) + text;
  }

  private padText(left: string, right: string, width: number): string {
    const spaceLeft = width - left.length - right.length;
    if (spaceLeft <= 0) {
      return left.substring(0, width - right.length - 1) + " " + right;
    }
    return left + " ".repeat(spaceLeft) + right;
  }

  private padThreeColumns(col1: string, col2: string, col3: string, width: number): string {
    // Column 2 and Column 3 take specific portions of right space
    // Let's say Col 2 (Qty) sits 8 chars inside from Col 3
    const len3 = 14; // "NGN 1,000,000" capacity
    const len2 = 5;  // "1,000" capacity
    const len1 = width - len3 - len2 - 2;

    const c1 = col1.substring(0, len1).padEnd(len1, ' ');
    const c2 = col2.substring(0, len2).padStart(len2, ' ');
    const c3 = col3.substring(0, len3).padStart(len3, ' ');

    return `${c1} ${c2}  ${c3}`;
  }

  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    words.forEach(word => {
      if ((currentLine + word).length <= width) {
        currentLine += (currentLine === '' ? '' : ' ') + word;
      } else {
        if (currentLine !== '') lines.push(currentLine);
        currentLine = word;
      }
    });
    if (currentLine !== '') lines.push(currentLine);
    return lines;
  }

  /**
   * Main driver: Connects to characters, prints reset and ASCII strings.
   */
  async printReceipt(sale: any, format: '58mm' | '80mm', profile: any): Promise<boolean> {
    try {
      const isConnected = await this.isConnected();
      if (!isConnected) {
        // Try connecting
        await this.connect();
      }

      const receiptText = this.formatReceiptText(sale, format, profile);
      
      // ESC/POS reset command: [0x1B, 0x40]
      const resetCmd = new Uint8Array([0x1B, 0x40]);
      await this.writeBytes(resetCmd);

      // Encode the text as pure ASCII/UTF-8 bytes
      const encoder = new TextEncoder();
      const stringBytes = encoder.encode(receiptText);
      await this.writeBytes(stringBytes);

      console.log("[BluetoothPrinter] Receipt text write complete.");
      return true;
    } catch (err) {
      console.error("[BluetoothPrinter] Failed to print receipt over Bluetooth channel:", err);
      throw err;
    }
  }
}

// Export singleton instance
export const bluetoothPrinterService = new WebBluetoothPrinterService();
