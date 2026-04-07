"""add_eval_jobs_table

Revision ID: b5f8e2a1c9d3
Revises: 03069a8f5e8c
Create Date: 2026-04-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b5f8e2a1c9d3'
down_revision: Union[str, None] = '03069a8f5e8c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'eval_jobs',
        sa.Column('job_id', sa.Text(), nullable=False),
        sa.Column('session_id', sa.Text(), nullable=True),
        sa.Column('user_id', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), nullable=False, server_default='pending'),
        sa.Column('progress', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('results', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('errors', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('job_id'),
    )
    op.create_index('idx_eval_jobs_status', 'eval_jobs', ['status'])
    op.create_index('idx_eval_jobs_user_id', 'eval_jobs', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_eval_jobs_user_id', table_name='eval_jobs')
    op.drop_index('idx_eval_jobs_status', table_name='eval_jobs')
    op.drop_table('eval_jobs')
