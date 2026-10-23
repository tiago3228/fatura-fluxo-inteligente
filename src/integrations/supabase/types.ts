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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      cards: {
        Row: {
          active: boolean
          brand: string | null
          closing_day: number
          created_at: string
          credit_limit: number | null
          due_day: number
          id: string
          issuer: string
          last4: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          closing_day: number
          created_at?: string
          credit_limit?: number | null
          due_day: number
          id?: string
          issuer: string
          last4: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          closing_day?: number
          created_at?: string
          credit_limit?: number | null
          due_day?: number
          id?: string
          issuer?: string
          last4?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plan_shares: {
        Row: {
          id: string
          percentage: number
          person_id: string
          plan_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          percentage: number
          person_id: string
          plan_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          percentage?: number
          person_id?: string
          plan_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plan_shares_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plan_shares_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plan_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          card_id: string
          created_at: string
          description: string
          first_month: string
          id: string
          installment_amounts: Json
          purchase_date: string
          total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          description: string
          first_month: string
          id?: string
          installment_amounts?: Json
          purchase_date: string
          total: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          description?: string
          first_month?: string
          id?: string
          installment_amounts?: Json
          purchase_date?: string
          total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          card_id: string
          created_at: string
          due_date: string
          id: string
          imported_at: string | null
          official_total: number
          original_filename: string | null
          payments: Json
          reference_month: string
          source: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          due_date: string
          id?: string
          imported_at?: string | null
          official_total: number
          original_filename?: string | null
          payments?: Json
          reference_month: string
          source?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          due_date?: string
          id?: string
          imported_at?: string | null
          official_total?: number
          original_filename?: string | null
          payments?: Json
          reference_month?: string
          source?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          active: boolean
          created_at: string
          id: string
          monthly_limit: number
          name: string
          notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_limit?: number
          name: string
          notes?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_limit?: number
          name?: string
          notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      person_cards: {
        Row: {
          card_id: string
          person_id: string
          workspace_id: string
        }
        Insert: {
          card_id: string
          person_id: string
          workspace_id: string
        }
        Update: {
          card_id?: string
          person_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_cards_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_cards_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_cards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          person_id: string
          transaction_id: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          person_id: string
          transaction_id: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          person_id?: string
          transaction_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_allocations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_allocations_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_allocations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          adjustment_note: string | null
          amount: number
          created_at: string
          description: string
          id: string
          installment_number: number | null
          installment_total: number | null
          invoice_id: string
          plan_id: string | null
          transaction_date: string
          transaction_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          adjustment_note?: string | null
          amount: number
          created_at?: string
          description: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          invoice_id: string
          plan_id?: string | null
          transaction_date: string
          transaction_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          adjustment_note?: string | null
          amount?: number
          created_at?: string
          description?: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          invoice_id?: string
          plan_id?: string | null
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          compact: boolean
          csv_separator: string
          duplicate_check: boolean
          persist: boolean
          reference_month: string
          updated_at: string
          warn_pct: number
          workspace_id: string
        }
        Insert: {
          compact?: boolean
          csv_separator?: string
          duplicate_check?: boolean
          persist?: boolean
          reference_month?: string
          updated_at?: string
          warn_pct?: number
          workspace_id: string
        }
        Update: {
          compact?: boolean
          csv_separator?: string
          duplicate_check?: boolean
          persist?: boolean
          reference_month?: string
          updated_at?: string
          warn_pct?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_state: {
        Row: {
          data: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          data: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_state_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: { Args: { p_name: string }; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
