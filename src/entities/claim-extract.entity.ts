import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('claimextract')
export class ClaimExtract {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'text' })
  example: string;

  @Column({ type: 'varchar', length: 255 })
  fieldname: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
} 