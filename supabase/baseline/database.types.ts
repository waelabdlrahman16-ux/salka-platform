export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      _mcd_menu_backup_20260806: {
        Row: {
          available: boolean | null
          available_from: string | null
          available_until: string | null
          category: string | null
          combo_label: string | null
          description: string | null
          id: number
          image_url: string | null
          is_shelf_label: boolean | null
          name: string | null
          price: number | null
          requires_prescription: boolean | null
          restaurant_id: number | null
        }
        Insert: {
          available?: boolean | null
          available_from?: string | null
          available_until?: string | null
          category?: string | null
          combo_label?: string | null
          description?: string | null
          id: number
          image_url?: string | null
          is_shelf_label?: boolean | null
          name?: string | null
          price?: number | null
          requires_prescription?: boolean | null
          restaurant_id?: number | null
        }
        Update: {
          available?: boolean | null
          available_from?: string | null
          available_until?: string | null
          category?: string | null
          combo_label?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          is_shelf_label?: boolean | null
          name?: string | null
          price?: number | null
          requires_prescription?: boolean | null
          restaurant_id?: number | null
        }
        Relationships: []
      }
      app_events: {
        Row: {
          compound_id: number | null
          created_at: string
          customer_id: number | null
          device_id: string | null
          event: string
          id: number
          order_id: number | null
          props: Json
          restaurant_id: number | null
          session_id: string | null
        }
        Insert: {
          compound_id?: number | null
          created_at?: string
          customer_id?: number | null
          device_id?: string | null
          event: string
          id?: number
          order_id?: number | null
          props?: Json
          restaurant_id?: number | null
          session_id?: string | null
        }
        Update: {
          compound_id?: number | null
          created_at?: string
          customer_id?: number | null
          device_id?: string | null
          event?: string
          id?: number
          order_id?: number | null
          props?: Json
          restaurant_id?: number | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_events_compound_id_fkey"
            columns: ["compound_id"]
            isOneToOne: false
            referencedRelation: "compounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      banned_customers: {
        Row: {
          banned_at: string
          banned_by: string | null
          phone: string
          reason: string | null
        }
        Insert: {
          banned_at?: string
          banned_by?: string | null
          phone: string
          reason?: string | null
        }
        Update: {
          banned_at?: string
          banned_by?: string | null
          phone?: string
          reason?: string | null
        }
        Relationships: []
      }
      banners: {
        Row: {
          active: boolean
          bg_color: string
          created_at: string
          ends_at: string | null
          id: number
          image_url: string | null
          link_url: string | null
          sort: number
          starts_at: string | null
          subtitle: string | null
          title: string
        }
        Insert: {
          active?: boolean
          bg_color?: string
          created_at?: string
          ends_at?: string | null
          id?: never
          image_url?: string | null
          link_url?: string | null
          sort?: number
          starts_at?: string | null
          subtitle?: string | null
          title: string
        }
        Update: {
          active?: boolean
          bg_color?: string
          created_at?: string
          ends_at?: string | null
          id?: never
          image_url?: string | null
          link_url?: string | null
          sort?: number
          starts_at?: string | null
          subtitle?: string | null
          title?: string
        }
        Relationships: []
      }
      complaints: {
        Row: {
          category: string
          created_at: string | null
          description: string
          driver_id: number | null
          id: number
          order_id: number | null
          status: string | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          description: string
          driver_id?: number | null
          id?: number
          order_id?: number | null
          status?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string
          driver_id?: number | null
          id?: number
          order_id?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "complaints_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      compounds: {
        Row: {
          active: boolean | null
          delivery_fee: number
          direction: string | null
          distance_km: number | null
          est_travel_minutes: number | null
          id: number
          latitude: number | null
          longitude: number | null
          name: string
          region_id: number
        }
        Insert: {
          active?: boolean | null
          delivery_fee: number
          direction?: string | null
          distance_km?: number | null
          est_travel_minutes?: number | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          name: string
          region_id: number
        }
        Update: {
          active?: boolean | null
          delivery_fee?: number
          direction?: string | null
          distance_km?: number | null
          est_travel_minutes?: number | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          name?: string
          region_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "compounds_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          compound_id: number
          created_at: string
          customer_id: number
          id: number
          is_default: boolean
          label: string
          notes: string | null
          unit_number: string
        }
        Insert: {
          compound_id: number
          created_at?: string
          customer_id: number
          id?: number
          is_default?: boolean
          label?: string
          notes?: string | null
          unit_number: string
        }
        Update: {
          compound_id?: number
          created_at?: string
          customer_id?: number
          id?: number
          is_default?: boolean
          label?: string
          notes?: string | null
          unit_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_compound_id_fkey"
            columns: ["compound_id"]
            isOneToOne: false
            referencedRelation: "compounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_otp_codes: {
        Row: {
          code: string
          expires_at: string
          id: number
          phone: string
          used: boolean | null
        }
        Insert: {
          code: string
          expires_at: string
          id?: number
          phone: string
          used?: boolean | null
        }
        Update: {
          code?: string
          expires_at?: string
          id?: number
          phone?: string
          used?: boolean | null
        }
        Relationships: []
      }
      customer_sessions: {
        Row: {
          created_at: string
          customer_id: number
          expires_at: string
          last_used_at: string
          token: string
        }
        Insert: {
          created_at?: string
          customer_id: number
          expires_at?: string
          last_used_at?: string
          token?: string
        }
        Update: {
          created_at?: string
          customer_id?: number
          expires_at?: string
          last_used_at?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_wallets: {
        Row: {
          balance: number
          id: number
          phone: string
        }
        Insert: {
          balance?: number
          id?: number
          phone: string
        }
        Update: {
          balance?: number
          id?: number
          phone?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          id: number
          name: string | null
          phone: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: number
          name?: string | null
          phone?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          id?: number
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      dead_push_tokens: {
        Row: {
          died_at: string
          err_code: string | null
          token: string
        }
        Insert: {
          died_at?: string
          err_code?: string | null
          token: string
        }
        Update: {
          died_at?: string
          err_code?: string | null
          token?: string
        }
        Relationships: []
      }
      delivery_assignments: {
        Row: {
          arrived_at_customer_at: string | null
          arrived_at_restaurant_at: string | null
          attempt_number: number
          called_customer_at: string | null
          cash_confirmed_at: string | null
          delivered_at: string | null
          delivery_problem_reason: string | null
          driver_id: number | null
          id: number
          no_answer_admin_action: string | null
          no_answer_reported_at: string | null
          offered_at: string | null
          order_id: number | null
          out_for_delivery_at: string | null
          picked_up_at: string | null
          rejection_reason: string | null
          responded_at: string | null
          status: string | null
        }
        Insert: {
          arrived_at_customer_at?: string | null
          arrived_at_restaurant_at?: string | null
          attempt_number?: number
          called_customer_at?: string | null
          cash_confirmed_at?: string | null
          delivered_at?: string | null
          delivery_problem_reason?: string | null
          driver_id?: number | null
          id?: number
          no_answer_admin_action?: string | null
          no_answer_reported_at?: string | null
          offered_at?: string | null
          order_id?: number | null
          out_for_delivery_at?: string | null
          picked_up_at?: string | null
          rejection_reason?: string | null
          responded_at?: string | null
          status?: string | null
        }
        Update: {
          arrived_at_customer_at?: string | null
          arrived_at_restaurant_at?: string | null
          attempt_number?: number
          called_customer_at?: string | null
          cash_confirmed_at?: string | null
          delivered_at?: string | null
          delivery_problem_reason?: string | null
          driver_id?: number | null
          id?: number
          no_answer_admin_action?: string | null
          no_answer_reported_at?: string | null
          offered_at?: string | null
          order_id?: number | null
          out_for_delivery_at?: string | null
          picked_up_at?: string | null
          rejection_reason?: string | null
          responded_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_slots: {
        Row: {
          active: boolean | null
          capacity: number
          end_time: string
          id: number
          restaurant_id: number | null
          start_time: string
        }
        Insert: {
          active?: boolean | null
          capacity?: number
          end_time: string
          id?: number
          restaurant_id?: number | null
          start_time: string
        }
        Update: {
          active?: boolean | null
          capacity?: number
          end_time?: string
          id?: number
          restaurant_id?: number | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_slots_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          discount_type: string
          ends_at: string | null
          id: number
          menu_item_id: number | null
          restaurant_id: number
          scope: string
          starts_at: string | null
          value: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          discount_type: string
          ends_at?: string | null
          id?: number
          menu_item_id?: number | null
          restaurant_id: number
          scope: string
          starts_at?: string | null
          value: number
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          discount_type?: string
          ends_at?: string | null
          id?: number
          menu_item_id?: number | null
          restaurant_id?: number
          scope?: string
          starts_at?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discounts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_device_log: {
        Row: {
          actor: string
          created_at: string
          device_id: string
          device_label: string | null
          driver_id: number
          id: number
          outcome: string
        }
        Insert: {
          actor?: string
          created_at?: string
          device_id: string
          device_label?: string | null
          driver_id: number
          id?: number
          outcome: string
        }
        Update: {
          actor?: string
          created_at?: string
          device_id?: string
          device_label?: string | null
          driver_id?: number
          id?: number
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_device_log_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_earnings: {
        Row: {
          admin_amount: number
          assignment_id: number | null
          created_at: string | null
          delivery_fee: number
          dispute_note: string | null
          disputed: boolean
          driver_earning: number
          driver_id: number | null
          id: number
          order_id: number | null
          paid: boolean | null
          paid_at: string | null
        }
        Insert: {
          admin_amount: number
          assignment_id?: number | null
          created_at?: string | null
          delivery_fee: number
          dispute_note?: string | null
          disputed?: boolean
          driver_earning: number
          driver_id?: number | null
          id?: number
          order_id?: number | null
          paid?: boolean | null
          paid_at?: string | null
        }
        Update: {
          admin_amount?: number
          assignment_id?: number | null
          created_at?: string | null
          delivery_fee?: number
          dispute_note?: string | null
          disputed?: boolean
          driver_earning?: number
          driver_id?: number | null
          id?: number
          order_id?: number | null
          paid?: boolean | null
          paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_earnings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "delivery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlements: {
        Row: {
          amount: number
          created_at: string | null
          driver_id: number | null
          id: number
          kind: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          driver_id?: number | null
          id?: number
          kind: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          driver_id?: number | null
          id?: number
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_shift_bonuses: {
        Row: {
          bonus_amount: number
          bonus_date: string
          created_at: string
          driver_id: number
          id: number
          orders_count: number
          paid: boolean
          tier_reached: number
        }
        Insert: {
          bonus_amount: number
          bonus_date: string
          created_at?: string
          driver_id: number
          id?: number
          orders_count: number
          paid?: boolean
          tier_reached: number
        }
        Update: {
          bonus_amount?: number
          bonus_date?: string
          created_at?: string
          driver_id?: number
          id?: number
          orders_count?: number
          paid?: boolean
          tier_reached?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_shift_bonuses_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_tips: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string
          driver_id: number
          id: number
          order_id: number
          status: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          created_at?: string
          driver_id: number
          id?: number
          order_id: number
          status?: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string
          driver_id?: number
          id?: number
          order_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_tips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_tips_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active: boolean | null
          available: boolean | null
          cash_held: number | null
          commission_value: number | null
          current_lat: number | null
          current_lng: number | null
          device_bound_at: string | null
          device_id: string | null
          device_label: string | null
          id: number
          instapay_number: string | null
          is_test: boolean
          location_updated_at: string | null
          name: string
          payout_schedule: string | null
          phone: string
          rating: number | null
          status: string | null
          total_deliveries: number | null
          vehicle_plate: string | null
          vehicle_type: string | null
        }
        Insert: {
          active?: boolean | null
          available?: boolean | null
          cash_held?: number | null
          commission_value?: number | null
          current_lat?: number | null
          current_lng?: number | null
          device_bound_at?: string | null
          device_id?: string | null
          device_label?: string | null
          id?: number
          instapay_number?: string | null
          is_test?: boolean
          location_updated_at?: string | null
          name: string
          payout_schedule?: string | null
          phone: string
          rating?: number | null
          status?: string | null
          total_deliveries?: number | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
        }
        Update: {
          active?: boolean | null
          available?: boolean | null
          cash_held?: number | null
          commission_value?: number | null
          current_lat?: number | null
          current_lng?: number | null
          device_bound_at?: string | null
          device_id?: string | null
          device_label?: string | null
          id?: number
          instapay_number?: string | null
          is_test?: boolean
          location_updated_at?: string | null
          name?: string
          payout_schedule?: string | null
          phone?: string
          rating?: number | null
          status?: string | null
          total_deliveries?: number | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          created_at: string
          display_order: number
          id: number
          name: string
          restaurant_id: number
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: number
          name: string
          restaurant_id: number
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: number
          name?: string
          restaurant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_addon_groups: {
        Row: {
          display_order: number
          id: number
          max_select: number | null
          menu_item_id: number
          min_select: number
          name: string
        }
        Insert: {
          display_order?: number
          id?: number
          max_select?: number | null
          menu_item_id: number
          min_select?: number
          name: string
        }
        Update: {
          display_order?: number
          id?: number
          max_select?: number | null
          menu_item_id?: number
          min_select?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_addon_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_addons: {
        Row: {
          available: boolean
          display_order: number
          group_id: number
          id: number
          image_url: string | null
          name: string
          price: number
        }
        Insert: {
          available?: boolean
          display_order?: number
          group_id: number
          id?: number
          image_url?: string | null
          name: string
          price?: number
        }
        Update: {
          available?: boolean
          display_order?: number
          group_id?: number
          id?: number
          image_url?: string | null
          name?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_addons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "menu_item_addon_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_combos: {
        Row: {
          available: boolean
          display_order: number
          id: number
          menu_item_id: number
          name: string
          price: number
        }
        Insert: {
          available?: boolean
          display_order?: number
          id?: number
          menu_item_id: number
          name: string
          price: number
        }
        Update: {
          available?: boolean
          display_order?: number
          id?: number
          menu_item_id?: number
          name?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_combos_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_sizes: {
        Row: {
          available: boolean
          display_order: number
          id: number
          is_default: boolean
          menu_item_id: number
          name: string
          price: number
        }
        Insert: {
          available?: boolean
          display_order?: number
          id?: number
          is_default?: boolean
          menu_item_id: number
          name: string
          price: number
        }
        Update: {
          available?: boolean
          display_order?: number
          id?: number
          is_default?: boolean
          menu_item_id?: number
          name?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_sizes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          available: boolean | null
          available_from: string | null
          available_until: string | null
          category: string | null
          combo_label: string | null
          description: string | null
          id: number
          image_url: string | null
          is_shelf_label: boolean
          name: string
          price: number
          requires_prescription: boolean | null
          restaurant_id: number | null
        }
        Insert: {
          available?: boolean | null
          available_from?: string | null
          available_until?: string | null
          category?: string | null
          combo_label?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          is_shelf_label?: boolean
          name: string
          price: number
          requires_prescription?: boolean | null
          restaurant_id?: number | null
        }
        Update: {
          available?: boolean | null
          available_from?: string | null
          available_until?: string | null
          category?: string | null
          combo_label?: string | null
          description?: string | null
          id?: number
          image_url?: string | null
          is_shelf_label?: boolean
          name?: string
          price?: number
          requires_prescription?: boolean | null
          restaurant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          addon_names: string[] | null
          combo_name: string | null
          created_by: string | null
          id: number
          is_adjustment: boolean
          menu_item_id: number | null
          name: string
          order_id: number | null
          original_unit_price: number | null
          qty: number
          requires_prescription: boolean | null
          service_fee_waived: number | null
          size_name: string | null
          total: number
          unit_price: number
        }
        Insert: {
          addon_names?: string[] | null
          combo_name?: string | null
          created_by?: string | null
          id?: number
          is_adjustment?: boolean
          menu_item_id?: number | null
          name: string
          order_id?: number | null
          original_unit_price?: number | null
          qty: number
          requires_prescription?: boolean | null
          service_fee_waived?: number | null
          size_name?: string | null
          total: number
          unit_price: number
        }
        Update: {
          addon_names?: string[] | null
          combo_name?: string | null
          created_by?: string | null
          id?: number
          is_adjustment?: boolean
          menu_item_id?: number | null
          name?: string
          order_id?: number | null
          original_unit_price?: number | null
          qty?: number
          requires_prescription?: boolean | null
          service_fee_waived?: number | null
          size_name?: string | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_ratings: {
        Row: {
          comment: string | null
          created_at: string | null
          driver_rating: number | null
          id: number
          order_id: number | null
          restaurant_rating: number | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          driver_rating?: number | null
          id?: number
          order_id?: number | null
          restaurant_rating?: number | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          driver_rating?: number | null
          id?: number
          order_id?: number | null
          restaurant_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor: string
          actor_uid: string | null
          created_at: string
          from_status: string | null
          id: number
          order_id: number
          to_status: string
        }
        Insert: {
          actor?: string
          actor_uid?: string | null
          created_at?: string
          from_status?: string | null
          id?: number
          order_id: number
          to_status: string
        }
        Update: {
          actor?: string
          actor_uid?: string | null
          created_at?: string
          from_status?: string | null
          id?: number
          order_id?: number
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_notes: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cod_deposit_amount: number | null
          collect_amount: number | null
          compound_id: number | null
          created_at: string | null
          customer_id: number | null
          customer_name: string
          customer_note: string | null
          customer_phone: string
          delay_count: number
          delivery_fee: number
          dispatch_at: string | null
          fawaterak_invoice_id: string | null
          fawaterak_invoice_key: string | null
          id: number
          instapay_claimed_at: string | null
          is_test: boolean
          kitchen_status: string | null
          late_alert_sent_at: string | null
          online_payment_status: string | null
          order_type: string
          payment_method: string | null
          payment_mode: string | null
          prescription_path: string | null
          pricing_status: string
          public_token: string | null
          push_platform: string
          push_token: string | null
          ready_at: string | null
          refund_status: string | null
          request_items: Json | null
          request_notes: string | null
          restaurant_id: number | null
          scheduled_date: string | null
          service_fee: number
          sla_minutes: number | null
          slot_id: number | null
          status: string | null
          subtotal: number
          total: number
          unit_number: string
          vendor_accepted_at: string | null
          wallet_used: number
          zone: string
        }
        Insert: {
          address_notes?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cod_deposit_amount?: number | null
          collect_amount?: number | null
          compound_id?: number | null
          created_at?: string | null
          customer_id?: number | null
          customer_name: string
          customer_note?: string | null
          customer_phone: string
          delay_count?: number
          delivery_fee?: number
          dispatch_at?: string | null
          fawaterak_invoice_id?: string | null
          fawaterak_invoice_key?: string | null
          id?: number
          instapay_claimed_at?: string | null
          is_test?: boolean
          kitchen_status?: string | null
          late_alert_sent_at?: string | null
          online_payment_status?: string | null
          order_type?: string
          payment_method?: string | null
          payment_mode?: string | null
          prescription_path?: string | null
          pricing_status?: string
          public_token?: string | null
          push_platform?: string
          push_token?: string | null
          ready_at?: string | null
          refund_status?: string | null
          request_items?: Json | null
          request_notes?: string | null
          restaurant_id?: number | null
          scheduled_date?: string | null
          service_fee?: number
          sla_minutes?: number | null
          slot_id?: number | null
          status?: string | null
          subtotal: number
          total: number
          unit_number: string
          vendor_accepted_at?: string | null
          wallet_used?: number
          zone: string
        }
        Update: {
          address_notes?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cod_deposit_amount?: number | null
          collect_amount?: number | null
          compound_id?: number | null
          created_at?: string | null
          customer_id?: number | null
          customer_name?: string
          customer_note?: string | null
          customer_phone?: string
          delay_count?: number
          delivery_fee?: number
          dispatch_at?: string | null
          fawaterak_invoice_id?: string | null
          fawaterak_invoice_key?: string | null
          id?: number
          instapay_claimed_at?: string | null
          is_test?: boolean
          kitchen_status?: string | null
          late_alert_sent_at?: string | null
          online_payment_status?: string | null
          order_type?: string
          payment_method?: string | null
          payment_mode?: string | null
          prescription_path?: string | null
          pricing_status?: string
          public_token?: string | null
          push_platform?: string
          push_token?: string | null
          ready_at?: string | null
          refund_status?: string | null
          request_items?: Json | null
          request_notes?: string | null
          restaurant_id?: number | null
          scheduled_date?: string | null
          service_fee?: number
          sla_minutes?: number | null
          slot_id?: number | null
          status?: string | null
          subtotal?: number
          total?: number
          unit_number?: string
          vendor_accepted_at?: string | null
          wallet_used?: number
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_compound_id_fkey"
            columns: ["compound_id"]
            isOneToOne: false
            referencedRelation: "compounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "delivery_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          driver_id: number | null
          id: string
          name: string | null
          restaurant_id: number | null
          role: string
        }
        Insert: {
          driver_id?: number | null
          id: string
          name?: string | null
          restaurant_id?: number | null
          role: string
        }
        Update: {
          driver_id?: number | null
          id?: string
          name?: string | null
          restaurant_id?: number | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      push_nudge: {
        Row: {
          attempts: number
          escalated: boolean
          kind: string
          last_at: string | null
          ref_id: number
        }
        Insert: {
          attempts?: number
          escalated?: boolean
          kind: string
          last_at?: string | null
          ref_id: number
        }
        Update: {
          attempts?: number
          escalated?: boolean
          kind?: string
          last_at?: string | null
          ref_id?: number
        }
        Relationships: []
      }
      push_send_log: {
        Row: {
          created_at: string
          err_code: string | null
          id: number
          ok: boolean
          platform: string | null
          profile_id: string | null
          status: number | null
          title: string | null
          token_prefix: string
        }
        Insert: {
          created_at?: string
          err_code?: string | null
          id?: number
          ok: boolean
          platform?: string | null
          profile_id?: string | null
          status?: number | null
          title?: string | null
          token_prefix: string
        }
        Update: {
          created_at?: string
          err_code?: string | null
          id?: number
          ok?: boolean
          platform?: string | null
          profile_id?: string | null
          status?: number | null
          title?: string | null
          token_prefix?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          id: number
          platform: string
          profile_id: string
          token: string
          updated_at: string
        }
        Insert: {
          id?: number
          platform?: string
          profile_id: string
          token: string
          updated_at?: string
        }
        Update: {
          id?: number
          platform?: string
          profile_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          bucket: string
          called_at: string
          id: number
        }
        Insert: {
          bucket: string
          called_at?: string
          id?: number
        }
        Update: {
          bucket?: string
          called_at?: string
          id?: number
        }
        Relationships: []
      }
      regions: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
      request_item_suppressions: {
        Row: {
          created_at: string
          id: number
          match_mode: string
          name: string
          reason: string | null
          restaurant_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          match_mode?: string
          name: string
          reason?: string | null
          restaurant_id: number
        }
        Update: {
          created_at?: string
          id?: number
          match_mode?: string
          name?: string
          reason?: string | null
          restaurant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "request_item_suppressions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          archived: boolean
          category: string | null
          closed_until: string | null
          cover_image_url: string | null
          description: string | null
          display_order: number | null
          featured: boolean
          id: number
          is_open: boolean | null
          is_test: boolean
          logo_url: string | null
          max_delivery_km: number | null
          name: string
          order_mode: string
          prep_minutes: number | null
          rating: number | null
          uses_delivery_slots: boolean
          vendor_type: string | null
        }
        Insert: {
          archived?: boolean
          category?: string | null
          closed_until?: string | null
          cover_image_url?: string | null
          description?: string | null
          display_order?: number | null
          featured?: boolean
          id?: number
          is_open?: boolean | null
          is_test?: boolean
          logo_url?: string | null
          max_delivery_km?: number | null
          name: string
          order_mode?: string
          prep_minutes?: number | null
          rating?: number | null
          uses_delivery_slots?: boolean
          vendor_type?: string | null
        }
        Update: {
          archived?: boolean
          category?: string | null
          closed_until?: string | null
          cover_image_url?: string | null
          description?: string | null
          display_order?: number | null
          featured?: boolean
          id?: number
          is_open?: boolean | null
          is_test?: boolean
          logo_url?: string | null
          max_delivery_km?: number | null
          name?: string
          order_mode?: string
          prep_minutes?: number | null
          rating?: number | null
          uses_delivery_slots?: boolean
          vendor_type?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          label: string | null
          value: string
        }
        Insert: {
          key: string
          label?: string | null
          value: string
        }
        Update: {
          key?: string
          label?: string | null
          value?: string
        }
        Relationships: []
      }
      settlement_requests: {
        Row: {
          created_at: string | null
          driver_id: number | null
          id: number
          resolved_at: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          driver_id?: number | null
          id?: number
          resolved_at?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          driver_id?: number | null
          id?: number
          resolved_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_requests_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swap_requests: {
        Row: {
          accepted_at: string | null
          accepted_by: number | null
          created_at: string | null
          escalated_at: string | null
          id: number
          reason: string | null
          requested_by: number
          shift_id: number
          status: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: number | null
          created_at?: string | null
          escalated_at?: string | null
          id?: number
          reason?: string | null
          requested_by: number
          shift_id: number
          status?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: number | null
          created_at?: string | null
          escalated_at?: string | null
          id?: number
          reason?: string | null
          requested_by?: number
          shift_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_requests_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string | null
          driver_id: number
          end_time: string
          id: number
          shift_date: string
          start_time: string
          status: string
        }
        Insert: {
          created_at?: string | null
          driver_id: number
          end_time: string
          id?: number
          shift_date: string
          start_time: string
          status?: string
        }
        Update: {
          created_at?: string | null
          driver_id?: number
          end_time?: string
          id?: number
          shift_date?: string
          start_time?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_addon_library: {
        Row: {
          created_at: string
          id: number
          image_url: string | null
          name: string
          price: number
          restaurant_id: number
        }
        Insert: {
          created_at?: string
          id?: number
          image_url?: string | null
          name: string
          price?: number
          restaurant_id: number
        }
        Update: {
          created_at?: string
          id?: number
          image_url?: string | null
          name?: string
          price?: number
          restaurant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_addon_library_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_coverage: {
        Row: {
          compound_id: number | null
          id: number
          restaurant_id: number | null
        }
        Insert: {
          compound_id?: number | null
          id?: number
          restaurant_id?: number | null
        }
        Update: {
          compound_id?: number | null
          id?: number
          restaurant_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_coverage_compound_id_fkey"
            columns: ["compound_id"]
            isOneToOne: false
            referencedRelation: "compounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_coverage_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_hours: {
        Row: {
          closed: boolean
          closes_at: string | null
          day_of_week: number
          opens_at: string | null
          restaurant_id: number
        }
        Insert: {
          closed?: boolean
          closes_at?: string | null
          day_of_week: number
          opens_at?: string | null
          restaurant_id: number
        }
        Update: {
          closed?: boolean
          closes_at?: string | null
          day_of_week?: number
          opens_at?: string | null
          restaurant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string | null
          id: number
          order_id: number | null
          reason: string | null
          wallet_id: number | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: number
          order_id?: number | null
          reason?: string | null
          wallet_id?: number | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: number
          order_id?: number | null
          reason?: string | null
          wallet_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "customer_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_swap: {
        Args: { p_auth_user_id?: string; p_request_id: number }
        Returns: Json
      }
      add_customer_address: {
        Args: {
          p_auth_user_id?: string
          p_compound_id: number
          p_is_default?: boolean
          p_label: string
          p_notes?: string
          p_unit_number: string
        }
        Returns: number
      }
      admin_add_menu_category: {
        Args: {
          p_auth_user_id?: string
          p_name: string
          p_restaurant_id: number
        }
        Returns: number
      }
      admin_adjust_order: {
        Args: {
          p_amount: number
          p_auth_user_id?: string
          p_charge_service_fee?: boolean
          p_order_id: number
          p_reason: string
        }
        Returns: Json
      }
      admin_assign_order: {
        Args: {
          p_auth_user_id?: string
          p_driver_id: number
          p_force?: boolean
          p_order_id: number
        }
        Returns: undefined
      }
      admin_confirm_cod_deposit: {
        Args: { p_auth_user_id?: string; p_order_id: number }
        Returns: undefined
      }
      admin_confirm_instapay_payment: {
        Args: { p_auth_user_id?: string; p_force?: boolean; p_order_id: number }
        Returns: undefined
      }
      admin_convert_staff_role: {
        Args: { p_auth_user_id?: string; p_profile_id: string; p_role: string }
        Returns: undefined
      }
      admin_customer_detail: {
        Args: { p_auth_user_id?: string; p_phone: string }
        Returns: Json
      }
      admin_customers: { Args: { p_auth_user_id?: string }; Returns: Json }
      admin_daily_report: {
        Args: { p_auth_user_id?: string; p_date?: string }
        Returns: Json
      }
      admin_delete_customer: {
        Args: {
          p_auth_user_id?: string
          p_customer_id: number
          p_force?: boolean
        }
        Returns: Json
      }
      admin_delete_customer_by_phone: {
        Args: { p_auth_user_id?: string; p_force?: boolean; p_phone: string }
        Returns: Json
      }
      admin_delete_menu_category: {
        Args: {
          p_auth_user_id?: string
          p_name: string
          p_restaurant_id: number
        }
        Returns: undefined
      }
      admin_delete_menu_item: {
        Args: { p_auth_user_id?: string; p_item_id: number }
        Returns: undefined
      }
      admin_delete_staff: {
        Args: {
          p_auth_user_id?: string
          p_force?: boolean
          p_profile_id: string
        }
        Returns: Json
      }
      admin_flag_driver_dispute: {
        Args: {
          p_auth_user_id?: string
          p_complaint_id: number
          p_note?: string
        }
        Returns: undefined
      }
      admin_force_delivered: {
        Args: {
          p_auth_user_id?: string
          p_cash_collected?: boolean
          p_order_id: number
          p_reason: string
        }
        Returns: undefined
      }
      admin_funnel: {
        Args: { p_auth_user_id?: string; p_days?: number }
        Returns: Json
      }
      admin_list_accounts: { Args: { p_auth_user_id?: string }; Returns: Json }
      admin_live_deliveries: {
        Args: { p_auth_user_id?: string }
        Returns: Json
      }
      admin_pending_refunds: {
        Args: { p_auth_user_id?: string }
        Returns: Json
      }
      admin_push_health: { Args: { p_auth_user_id?: string }; Returns: Json }
      admin_reassign_order: {
        Args: {
          p_auth_user_id?: string
          p_driver_id: number
          p_order_id: number
          p_reason?: string
        }
        Returns: undefined
      }
      admin_rename_menu_category: {
        Args: {
          p_auth_user_id?: string
          p_new: string
          p_old: string
          p_restaurant_id: number
        }
        Returns: undefined
      }
      admin_reorder_menu_categories: {
        Args: {
          p_auth_user_id?: string
          p_names: string[]
          p_restaurant_id: number
        }
        Returns: undefined
      }
      admin_reset_driver_device: {
        Args: { p_auth_user_id?: string; p_driver_id: number }
        Returns: undefined
      }
      admin_resolve_no_answer: {
        Args: {
          p_action: string
          p_assignment_id: number
          p_auth_user_id?: string
        }
        Returns: undefined
      }
      admin_set_compound_fee: {
        Args: { p_auth_user_id?: string; p_compound_id: number; p_fee: number }
        Returns: undefined
      }
      admin_set_customer_ban: {
        Args: {
          p_auth_user_id?: string
          p_banned: boolean
          p_phone: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_set_restaurant_rank: {
        Args: {
          p_auth_user_id?: string
          p_display_order: number
          p_featured?: boolean
          p_restaurant_id: number
        }
        Returns: undefined
      }
      admin_set_vendor_hours: {
        Args: { p_auth_user_id?: string; p_days: Json; p_restaurant_id: number }
        Returns: undefined
      }
      admin_set_vendor_slots: {
        Args: {
          p_auth_user_id?: string
          p_enabled: boolean
          p_restaurant_id: number
        }
        Returns: boolean
      }
      admin_stalled_orders: { Args: { p_auth_user_id?: string }; Returns: Json }
      admin_unassign_order: {
        Args: { p_auth_user_id?: string; p_order_id: number; p_reason?: string }
        Returns: undefined
      }
      admin_upsert_compound: {
        Args: {
          p_active?: boolean
          p_auth_user_id?: string
          p_delivery_fee: number
          p_direction?: string
          p_distance_km?: number
          p_id: number
          p_latitude?: number
          p_longitude?: number
          p_name: string
          p_region_id: number
        }
        Returns: Json
      }
      admin_upsert_driver: {
        Args: {
          p_active?: boolean
          p_auth_user_id?: string
          p_id: number
          p_instapay_number?: string
          p_name: string
          p_payout_schedule?: string
          p_phone: string
          p_vehicle_plate?: string
          p_vehicle_type?: string
        }
        Returns: Json
      }
      admin_vendors_without_items: {
        Args: { p_auth_user_id?: string }
        Returns: Json
      }
      append_request_items: {
        Args: { p_items: Json; p_rate_key: string; p_token: string }
        Returns: Json
      }
      apply_library_addon: {
        Args: {
          p_auth_user_id?: string
          p_group_name?: string
          p_item_ids: number[]
          p_library_id: number
        }
        Returns: number
      }
      available_orders: { Args: { p_auth_user_id?: string }; Returns: Json }
      cancel_order: {
        Args: { p_order_id: number; p_reason?: string; p_token?: string }
        Returns: undefined
      }
      check_and_award_shift_bonus: {
        Args: { p_driver_id: number }
        Returns: undefined
      }
      check_discount_conflict: {
        Args: {
          p_auth_user_id?: string
          p_category?: string
          p_exclude_id?: number
          p_menu_item_id?: number
          p_restaurant_id: number
          p_scope: string
        }
        Returns: Json
      }
      check_late_unclaimed_orders: { Args: never; Returns: undefined }
      check_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      claim_order: {
        Args: { p_auth_user_id?: string; p_order_id: number }
        Returns: Json
      }
      clear_my_location: {
        Args: { p_auth_user_id?: string }
        Returns: undefined
      }
      confirm_custom_order_price: {
        Args: {
          p_auth_user_id?: string
          p_order_id: number
          p_subtotal: number
        }
        Returns: undefined
      }
      credit_wallet: {
        Args: {
          p_amount: number
          p_auth_user_id?: string
          p_order_id?: number
          p_phone: string
          p_reason: string
        }
        Returns: undefined
      }
      current_actor_label: { Args: never; Returns: string }
      day_window_covers: {
        Args: {
          p_closes: string
          p_is_prev_day: boolean
          p_now: string
          p_opens: string
        }
        Returns: boolean
      }
      delete_customer_address: {
        Args: { p_auth_user_id?: string; p_id: number }
        Returns: undefined
      }
      delivery_fee_for_distance: { Args: { p_km: number }; Returns: number }
      delivery_quote: {
        Args: { p_compound_id: number; p_restaurant_id?: number }
        Returns: Json
      }
      driver_accept_assignment: {
        Args: {
          p_assignment_id: number
          p_auth_user_id?: string
          p_order_id: number
        }
        Returns: undefined
      }
      driver_arrived_at_customer: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_arrived_at_restaurant: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_called_customer: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_can_take_order: {
        Args: { p_driver_id: number; p_order_id: number }
        Returns: boolean
      }
      driver_claim_device: {
        Args: { p_auth_user_id?: string; p_device_id: string; p_label?: string }
        Returns: Json
      }
      driver_confirm_cash_received: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_mark_out_for_delivery: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_mark_picked_up: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_reject_assignment: {
        Args: {
          p_assignment_id: number
          p_auth_user_id?: string
          p_reason?: string
        }
        Returns: undefined
      }
      driver_report_no_answer: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      driver_report_problem: {
        Args: {
          p_assignment_id: number
          p_auth_user_id?: string
          p_reason: string
        }
        Returns: undefined
      }
      driver_set_available: {
        Args: { p_auth_user_id?: string; p_available: boolean }
        Returns: undefined
      }
      escalate_swap: {
        Args: { p_auth_user_id?: string; p_request_id: number }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_banned: { Args: { p_phone: string }; Returns: boolean }
      is_catalog_manager: { Args: never; Returns: boolean }
      is_customer_cancellable_status: {
        Args: { p_status: string }
        Returns: boolean
      }
      is_predispatch_status: { Args: { p_status: string }; Returns: boolean }
      is_supervisor: { Args: never; Returns: boolean }
      last_address_for_phone: {
        Args: {
          p_auth_user_id: string
          p_phone: string
          p_session_token: string
        }
        Returns: Json
      }
      log_app_event: {
        Args: {
          p_auth_user_id?: string
          p_compound_id?: number
          p_device_id?: string
          p_event: string
          p_order_id?: number
          p_props?: Json
          p_restaurant_id?: number
          p_session_id?: string
        }
        Returns: undefined
      }
      mark_delivered: {
        Args: {
          p_assignment_id: number
          p_auth_user_id?: string
          p_order_id: number
        }
        Returns: undefined
      }
      mark_delivery_failed: {
        Args: { p_assignment_id: number; p_auth_user_id?: string }
        Returns: undefined
      }
      mark_instapay_claimed: { Args: { p_token: string }; Returns: undefined }
      mark_refunded: {
        Args: { p_auth_user_id?: string; p_order_id: number }
        Returns: undefined
      }
      my_customer_addresses: {
        Args: { p_auth_user_id?: string }
        Returns: Json
      }
      my_customer_id: { Args: never; Returns: number }
      my_customer_orders: { Args: { p_auth_user_id?: string }; Returns: Json }
      my_customer_profile: { Args: { p_auth_user_id?: string }; Returns: Json }
      my_driver_id: { Args: never; Returns: number }
      my_driver_stats: { Args: { p_auth_user_id?: string }; Returns: Json }
      my_last_request: {
        Args: {
          p_auth_user_id: string
          p_restaurant_id: number
          p_session_token: string
        }
        Returns: Json
      }
      my_orders: {
        Args: {
          p_auth_user_id: string
          p_phone: string
          p_session_token: string
        }
        Returns: Json
      }
      my_restaurant_id: { Args: never; Returns: number }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      notify_admin: {
        Args: { p_body: string; p_data?: Json; p_title: string }
        Returns: undefined
      }
      notify_new_order_for: { Args: { p_order_id: number }; Returns: undefined }
      open_slots: { Args: { p_restaurant_id: number }; Returns: Json }
      open_swaps: { Args: { p_auth_user_id?: string }; Returns: Json }
      order_is_dispatchable: { Args: { p_order_id: number }; Returns: boolean }
      place_order: {
        Args: {
          p_address_notes: string
          p_auth_user_id?: string
          p_compound_id?: number
          p_customer_name: string
          p_customer_note?: string
          p_customer_phone: string
          p_delivery_fee: number
          p_items: Json
          p_payment_method?: string
          p_rate_key?: string
          p_restaurant_id: number
          p_scheduled_date?: string
          p_session_token?: string
          p_slot_id?: number
          p_unit_number: string
          p_use_wallet?: boolean
          p_zone: string
        }
        Returns: Json
      }
      popular_request_items: {
        Args: { p_restaurant_id: number }
        Returns: Json
      }
      push_nudge_sweep: { Args: never; Returns: Json }
      push_send: {
        Args: {
          p_body: string
          p_data?: Json
          p_targets: Json
          p_title: string
        }
        Returns: undefined
      }
      record_push_result: {
        Args: {
          p_err_code: string
          p_ok: boolean
          p_status: number
          p_title: string
          p_token: string
        }
        Returns: undefined
      }
      request_early_settlement: {
        Args: { p_auth_user_id?: string }
        Returns: undefined
      }
      request_pickup: {
        Args: {
          p_address_notes: string
          p_auth_user_id?: string
          p_collect_amount: number
          p_compound_id?: number
          p_customer_name: string
          p_customer_phone: string
          p_delivery_fee: number
          p_payment_mode: string
          p_rate_key?: string
          p_request_notes: string
          p_restaurant_id: number
          p_session_token?: string
          p_unit_number: string
          p_zone: string
        }
        Returns: Json
      }
      request_swap: {
        Args: { p_auth_user_id?: string; p_reason?: string; p_shift_id: number }
        Returns: Json
      }
      restaurant_public: { Args: { p_id: number }; Returns: Json }
      restaurant_reliability: {
        Args: { p_auth_user_id?: string; p_restaurant_id: number }
        Returns: Json
      }
      restaurants_for_compound: {
        Args: { p_compound_id: number }
        Returns: Json
      }
      restaurants_reliability_all: {
        Args: { p_auth_user_id?: string }
        Returns: Json
      }
      save_customer_push_token: {
        Args: {
          p_auth_user_id?: string
          p_platform?: string
          p_push_token: string
          p_token: string
        }
        Returns: Json
      }
      save_my_push_token: {
        Args: {
          p_auth_user_id?: string
          p_platform?: string
          p_push_token: string
        }
        Returns: Json
      }
      search_menu_for_compound: {
        Args: { p_compound_id: number; p_limit?: number; p_q: string }
        Returns: Json
      }
      session_logout: { Args: { p_token: string }; Returns: undefined }
      session_whoami: { Args: { p_token: string }; Returns: Json }
      set_default_address: {
        Args: { p_auth_user_id?: string; p_id: number }
        Returns: undefined
      }
      set_verified_customer_phone: {
        Args: { p_auth_user_id: string; p_phone: string }
        Returns: Json
      }
      settle_driver_cash: {
        Args: { p_auth_user_id?: string; p_driver_id: number }
        Returns: undefined
      }
      settle_driver_earnings: {
        Args: { p_auth_user_id?: string; p_driver_id: number }
        Returns: undefined
      }
      sla_max_minutes: { Args: { p_min: number }; Returns: number }
      sla_minutes_for: {
        Args: { p_compound_id: number; p_restaurant_id: number }
        Returns: number
      }
      sla_minutes_for_distance: { Args: { p_km: number }; Returns: number }
      staff_create_pickup_order: {
        Args: {
          p_address_notes?: string
          p_auth_user_id?: string
          p_collect_amount?: number
          p_compound_id: number
          p_customer_name: string
          p_customer_phone: string
          p_request_notes?: string
          p_restaurant_id: number
          p_unit_number: string
        }
        Returns: Json
      }
      staff_vendor_open_states: {
        Args: { p_auth_user_id?: string }
        Returns: Json
      }
      stalled_orders: {
        Args: never
        Returns: {
          compound_name: string
          customer_name: string
          customer_phone: string
          id: number
          minutes_stalled: number
          payment_method: string
          reference_at: string
          status: string
          threshold_minutes: number
          total: number
          vendor_name: string
        }[]
      }
      submit_complaint: {
        Args: { p_category?: string; p_description: string; p_token: string }
        Returns: undefined
      }
      submit_custom_order: {
        Args: {
          p_address_notes: string
          p_auth_user_id?: string
          p_compound_id?: number
          p_customer_name: string
          p_customer_phone: string
          p_delivery_fee: number
          p_prescription_path?: string
          p_rate_key?: string
          p_request_items: Json
          p_request_notes: string
          p_restaurant_id: number
          p_scheduled_date?: string
          p_session_token?: string
          p_slot_id?: number
          p_unit_number: string
          p_zone: string
        }
        Returns: Json
      }
      submit_rating: {
        Args: {
          p_auth_user_id?: string
          p_comment?: string
          p_driver_rating?: number
          p_restaurant_rating?: number
          p_token: string
        }
        Returns: undefined
      }
      submit_tip: {
        Args: { p_amount: number; p_token: string }
        Returns: undefined
      }
      supervisor_may_touch_order: {
        Args: { p_order_id: number }
        Returns: boolean
      }
      switch_to_cash: { Args: { p_token: string }; Returns: Json }
      time_within_window: {
        Args: { p_closes: string; p_now: string; p_opens: string }
        Returns: boolean
      }
      track_order: { Args: { p_token: string }; Returns: Json }
      travel_minutes_for_compound: {
        Args: { p_compound_id: number }
        Returns: number
      }
      travel_minutes_for_distance: { Args: { p_km: number }; Returns: number }
      update_customer_address: {
        Args: {
          p_auth_user_id?: string
          p_compound_id: number
          p_id: number
          p_label: string
          p_notes: string
          p_unit_number: string
        }
        Returns: undefined
      }
      update_my_customer_name: {
        Args: { p_auth_user_id?: string; p_name: string }
        Returns: undefined
      }
      update_my_customer_phone: {
        Args: { p_phone: string }
        Returns: undefined
      }
      update_my_location: {
        Args: { p_auth_user_id?: string; p_lat: number; p_lng: number }
        Returns: undefined
      }
      vendor_accept_order: {
        Args: {
          p_auth_user_id?: string
          p_order_id: number
          p_prep_minutes: number
        }
        Returns: undefined
      }
      vendor_covers_compound: {
        Args: { p_compound_id: number; p_restaurant_id: number }
        Returns: boolean
      }
      vendor_delay: {
        Args: { p_auth_user_id?: string; p_minutes: number; p_order_id: number }
        Returns: undefined
      }
      vendor_delivery_overview: {
        Args: { p_auth_user_id?: string; p_order_ids: number[] }
        Returns: {
          arrived_at_restaurant_at: string
          driver_name: string
          driver_phone: string
          order_id: number
          out_for_delivery_at: string
          status: string
        }[]
      }
      vendor_is_open_now: {
        Args: { p_restaurant_id: number }
        Returns: boolean
      }
      vendor_next_open_at: {
        Args: { p_restaurant_id: number }
        Returns: string
      }
      vendor_open_states: { Args: never; Returns: Json }
      vendor_ready: {
        Args: { p_auth_user_id?: string; p_order_id: number }
        Returns: undefined
      }
      vendor_set_item_availability: {
        Args: {
          p_auth_user_id?: string
          p_available: boolean
          p_item_id: number
        }
        Returns: undefined
      }
      vendor_set_open: {
        Args: { p_auth_user_id?: string; p_open: boolean }
        Returns: string
      }
      wallet_balance_for_phone: {
        Args: {
          p_auth_user_id: string
          p_phone: string
          p_session_token: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
