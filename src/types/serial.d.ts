// Web Serial API type definitions
declare global {
  interface SerialPort extends EventTarget {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }

  interface SerialPortInfo {
    readonly usbVendorId?: number;
    readonly usbProductId?: number;
  }

  interface Serial extends EventTarget {
    onconnect: ((this: Serial, ev: Event) => any) | null;
    ondisconnect: ((this: Serial, ev: Event) => any) | null;
    getPorts(): Promise<SerialPort[]>;
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  }

  interface SerialPortRequestOptions {
    filters: SerialPortFilter[];
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface Navigator {
    readonly serial: Serial;
  }
}

export {};
