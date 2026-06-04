/**
 * Triggers a robust print setup of a specific container's HTML inside an iframe context,
 * which is highly compatible with sandboxed iframes (e.g., AI Studio preview, local wrappers).
 */
function updateDebugStep(stepId: number, status: 'Pending' | 'Success' | 'Warning' | 'Failed', message?: string) {
  if (typeof window !== 'undefined' && (window as any).__PRINT_DEBUG__) {
    (window as any).__PRINT_DEBUG__.updateStep(stepId, status, message);
  }
}

export function printElementViaIframe(elementId: string, printFormat: '58mm' | '80mm' | 'standard') {
  const format = printFormat;
  
  if (typeof window !== 'undefined' && (window as any).__PRINT_DEBUG__) {
    (window as any).__PRINT_DEBUG__.printFormat = printFormat;
    (window as any).__PRINT_DEBUG__.receiptWidth = printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : 'auto';
    (window as any).__PRINT_DEBUG__.printMethod = "iframe.contentWindow.print()";
  }

  updateDebugStep(1, 'Success', `Initiated receipt printing (format: ${printFormat})`);

  let element: HTMLElement | null = null;
  try {
    element = document.getElementById(elementId) as HTMLElement | null;
    if (!element) {
      element = document.getElementById('portal-printable-receipt') as HTMLElement | null;
    }
    if (!element) {
      element = document.getElementById('printable-receipt-container') as HTMLElement | null;
    }
    if (!element) {
      element = (document.querySelector('[id*="receipt"]') || document.querySelector('[id*="printable"]')) as HTMLElement | null;
    }
  } catch (error: any) {
    console.error("[PrintHelper] Error locating target element:", error);
    updateDebugStep(3, 'Failed', `Error checking target layout: ${error.message}`);
  }

  if (!element) {
    updateDebugStep(3, 'Failed', `Element target elements could not be resolved!`);
    console.error(`[PrintHelper] Element with ID "${elementId}" not found for iframe printing. Falling back to window.print()`);
    try {
      updateDebugStep(8, 'Warning', 'Redirecting to global window.print() selector due to element omission');
      window.print();
    } catch (err: any) {
      console.error("[PrintHelper] Error triggering fallback window.print():", err);
      updateDebugStep(8, 'Failed', `Omissions fallback layout printed with failure: ${err.message}`);
    }
    return;
  }

  updateDebugStep(3, 'Success', `Target element successfully located in DOM tree.`);

  let baseHtml = '';
  try {
    baseHtml = element.innerHTML;
    updateDebugStep(2, 'Success', `Built custom print raw output (HTML size: ${baseHtml.length} bytes)`);
  } catch (error: any) {
    console.error("[PrintHelper] Error getting element innerHTML:", error);
    updateDebugStep(2, 'Failed', `Error building content string: ${error.message}`);
  }
  
  let iframe: HTMLIFrameElement;
  try {
    iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.zIndex = '-9999';
    updateDebugStep(4, 'Success', `Sandbox iframe memory workspace initialized.`);
  } catch (error: any) {
    console.error("[PrintHelper] Error creating iframe:", error);
    updateDebugStep(4, 'Failed', `Failed constructing iframe node: ${error.message}`);
    try {
      window.print();
    } catch (e) {
      console.error("[PrintHelper] Failed window.print() fallback:", e);
    }
    return;
  }

  try {
    document.body.appendChild(iframe);
    updateDebugStep(4, 'Success', `Sandbox iframe tree attached to active viewport.`);
  } catch (error: any) {
    console.error("[PrintHelper] Error appending iframe to DOM:", error);
    updateDebugStep(4, 'Failed', `Failed appending sandbox to DOM body: ${error.message}`);
    try {
      window.print();
    } catch (e) {
      console.error("[PrintHelper] Failed window.print() fallback:", e);
    }
    return;
  }

  let doc: Document | null = null;
  try {
    doc = iframe.contentWindow?.document || iframe.contentDocument;
  } catch (error) {
    console.error("[PrintHelper] Error getting iframe document object:", error);
  }

  if (!doc) {
    updateDebugStep(4, 'Failed', `Could not fetch inner frames contentDocument interface structure`);
    console.error('[PrintHelper] Could not access iframe document workspace. Falling back to window.print()');
    try {
      window.print();
    } catch (err) {
      console.error("[PrintHelper] Failed window.print() fallback:", err);
    }
    return;
  }

  // Pick up existing stylesheet links so styles copy over perfectly
  let styleTags = '';
  try {
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((styleNode) => {
      styleTags += styleNode.outerHTML;
    });
    updateDebugStep(6, 'Success', `Dynamically imported ${document.querySelectorAll('link[rel="stylesheet"], style').length} current UI style blocks to iframe context.`);
  } catch (error: any) {
    console.error("[PrintHelper] Error collecting stylesheets:", error);
    updateDebugStep(6, 'Warning', `Could not completely synchronise app style references: ${error.message}`);
  }

  try {
    doc.open();
  } catch (error: any) {
    console.error("[PrintHelper] Error opening iframe document:", error);
  }

  let pageCss = '';
  try {
    pageCss = `@page { size: ${printFormat === '58mm' ? '58mm auto' : printFormat === '80mm' ? '80mm auto' : 'auto'}; margin: 0; }`;
    updateDebugStep(7, 'Success', `Applied active CSS parameters format size specs: ${pageCss}`);
    if (typeof window !== 'undefined' && (window as any).__PRINT_DEBUG__) {
      (window as any).__PRINT_DEBUG__.generatedCss = pageCss;
    }
  } catch (error: any) {
    console.error("[PrintHelper] Error generating or logging page CSS:", error);
    updateDebugStep(7, 'Failed', `Error binding specific styles: ${error.message}`);
  }

  const isReceipt = printFormat === '58mm' || printFormat === '80mm';
  const widthVal = isReceipt ? printFormat : 'auto';

  try {
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>BIZSEQ Receipt Print</title>
          ${styleTags}
          <style>
            ${pageCss}
            @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Inter:wght@400;500;700;900&display=swap');
            
            body {
              background-color: white !important;
              color: black !important;
              margin: 0 !important;
              padding: 0 !important;
              font-family: ${printFormat === 'standard' ? '"Inter", sans-serif' : '"JetBrains Mono", monospace'} !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            ${isReceipt ? `
            html,
            body {
              width: ${widthVal} !important;
              max-width: ${widthVal} !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }
            ` : ''}

            #printable-receipt-container {
              width: ${isReceipt ? widthVal : '100%'} !important;
              max-width: ${isReceipt ? widthVal : '100%'} !important;
              margin: 0 auto !important;
              padding: 0 !important;
              box-shadow: none !important;
              border-radius: 0 !important;
            }

            /* Overrule sizes strictly to respect selection */
            .printable-root {
              display: block !important;
              visibility: visible !important;
              width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
              max-width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
              margin: 0 auto !important;
              padding: ${printFormat === 'standard' ? '20px' : '0px'} !important;
              box-sizing: border-box !important;
            }

            @media print {
              html, body {
                background: white !important;
                color: black !important;
                margin: 0 !important;
                padding: 0 !important;
              }
              .printable-root {
                width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
                max-width: ${printFormat === '58mm' ? '58mm' : printFormat === '80mm' ? '80mm' : '210mm'} !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="printable-root">
            ${baseHtml}
          </div>
        </body>
      </html>
    `);
    updateDebugStep(5, 'Success', `Injected full HTML template and dynamic classes.`);
  } catch (error: any) {
    console.error("[PrintHelper] Error writing HTML to iframe:", error);
    updateDebugStep(5, 'Failed', `HTML Injection crash: ${error.message}`);
  }

  try {
    doc.close();
  } catch (error: any) {
    console.error("[PrintHelper] Error closing iframe document:", error);
  }

  // Trigger print and clean up
  setTimeout(() => {
    const hasContentWindow = !!iframe.contentWindow;

    if (hasContentWindow) {
      try {
        iframe.contentWindow?.focus();
      } catch (error) {
        console.error("[PrintHelper] Error focusing iframe contentWindow:", error);
      }

      try {
        updateDebugStep(8, 'Success', 'Launching print overlay from target window frame object...');
        iframe.contentWindow?.print();
        updateDebugStep(9, 'Success', 'Printer spooler accepted raw print job frame target');
      } catch (e: any) {
        updateDebugStep(8, 'Warning', `Print triggers failed: ${e.message}. Executing parent fallback window.print()`);
        console.warn("[PrintHelper] Failed standard iframe trigger. Falling back to parent print request.", e);
        try {
          window.print();
        } catch (err) {
          console.error("[PrintHelper] Error running fallback window.print():", err);
        }
      }
    } else {
      updateDebugStep(8, 'Warning', 'contentWindow not available. Invoking parents window.print() dialog.');
      console.warn("[PrintHelper] contentWindow not available. Triggering window.print()");
      try {
        window.print();
      } catch (err) {
        console.error("[PrintHelper] Error running window.print():", err);
      }
    }

    // Clean up iframe after printing is prompted
    setTimeout(() => {
      try {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
          updateDebugStep(12, 'Success', `Cleaned up memory footprint. Diagnostics task done.`);
        }
      } catch (error) {
        console.error("[PrintHelper] Error during cleanup stage:", error);
      }
    }, 15000); 
  }, 1000);
}
