import { create } from 'zustand';
import { Product, SaleItem, UserProfile, Sale } from '../types';

interface CartItem extends SaleItem {
  id: string; // productId
  stock: number;
}

interface AppState {
  // POS Cart
  cart: CartItem[];
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  
  // Offline status
  isOnline: boolean;
  setOnline: (status: boolean) => void;
  
  // App Settings
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const useStore = create<AppState>((set) => ({
  cart: [],
  isOnline: navigator.onLine,
  darkMode: false,
  
  addToCart: (product) => set((state) => {
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
      return {
        cart: state.cart.map(item => 
          item.id === product.id 
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.price }
            : item
        )
      };
    }
    return {
      cart: [
        ...state.cart,
        {
          id: product.id,
          productId: product.id,
          name: product.name,
          quantity: 1,
          price: product.price,
          cost: product.cost || 0,
          total: product.price,
          stock: product.stock,
          unitName: 'Piece',
          conversionRate: 1
        } as any
      ]
    };
  }),
  
  removeFromCart: (productId) => set((state) => ({
    cart: state.cart.filter(item => item.id !== productId)
  })),
  
  updateQuantity: (productId, quantity) => set((state) => ({
    cart: state.cart.map(item => 
      item.id === productId 
        ? { ...item, quantity, total: quantity * item.price }
        : item
    )
  })),
  
  clearCart: () => set({ cart: [] }),
  
  setOnline: (status) => set({ isOnline: status }),
  
  toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode }))
}));
