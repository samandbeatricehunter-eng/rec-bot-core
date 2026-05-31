-- REC Core legacy baseline repair from approved migration spreadsheet.
-- Run manually in Supabase SQL Editor if repair has not already been applied.

begin;

create temp table tmp_approved_baseline(
  discord_id text primary key,
  display_name text,
  wins int,
  losses int,
  ties int,
  playoff_wins int,
  playoff_losses int,
  superbowl_wins int,
  superbowl_losses int,
  point_differential int,
  wallet_balance int,
  savings_balance int,
  pending_purchases int,
  pending_value_already_deducted int
) on commit drop;

insert into tmp_approved_baseline values
('1037925434123358258','.leek25',40,34,0,0,2,0,0,91,265,760,2,1275),
('327476050202329088','ace_peets',15,11,0,0,1,0,0,51,3730,0,1,150),
('792819168461324290','kayo4l',45,22,0,5,5,0,0,327,1100,2858,1,200),
('1240155951571533924','kingmindset9',27,42,2,0,2,0,0,-277,75,136,2,1800),
('633137901558824960','slick09145',48,27,1,5,5,0,0,542,0,4337,2,0),
('954239175400488990','snakesozoipad',46,25,0,10,0,0,0,197,1563,0,1,1000),
('521551549873258506','xkingneilx',45,4,0,8,0,0,0,744,2685,3662,1,1000),
('498875162851147786','.bigtugboat',26,33,0,0,5,0,0,-77,4763,0,0,0),
('1143701948915273839','assnsaddiction_42154',49,27,0,2,5,0,0,394,1797,1945,0,0),
('1037174918896439327','berlinstoejam',27,24,0,1,2,0,0,2,4097,0,0,0),
('838230365252485120','lrico',34,30,0,2,4,0,0,-206,7185,0,0,0),
('1219706528794152960','nospamej_',7,11,0,0,2,0,0,18,980,0,0,0),
('1477612223663706185','reapdolla',43,31,0,2,2,0,0,-7,3621,0,0,0),
('1422323774224732280','samuelpatrickhunter',49,31,0,2,5,0,0,36,410,1447,0,0),
('1361823949847007294','smoke_1g4l',38,30,0,3,5,0,0,-75,200,1507,0,0),
('1349158444204298358','the_biggest_tyme_66873',66,21,0,10,6,0,0,802,1385,8885,0,0),
('1265890423986192416','truckman1404',26,24,0,0,2,0,0,-33,5780,0,0,0);

create temp table tmp_current as
select a.*, u.id as user_id,
  u.display_name as current_display_name,
  coalesce(r.wins,0) current_wins, coalesce(r.losses,0) current_losses, coalesce(r.ties,0) current_ties,
  coalesce(r.playoff_wins,0) current_playoff_wins, coalesce(r.playoff_losses,0) current_playoff_losses,
  coalesce(r.superbowl_wins,0) current_superbowl_wins, coalesce(r.superbowl_losses,0) current_superbowl_losses,
  coalesce(r.point_differential,0) current_point_differential,
  coalesce(w.wallet_balance,0) current_wallet_balance, coalesce(w.savings_balance,0) current_savings_balance
from tmp_approved_baseline a
join rec_discord_accounts d on d.discord_id = a.discord_id
join rec_users u on u.id = d.user_id
left join rec_global_user_records r on r.user_id = u.id
left join rec_wallets w on w.user_id = u.id;

do $$
declare expected_count int; matched_count int;
begin
  select count(*) into expected_count from tmp_approved_baseline;
  select count(*) into matched_count from tmp_current;
  if expected_count <> matched_count then
    raise exception 'Approved baseline repair aborted: expected % users but matched % users.', expected_count, matched_count;
  end if;
end $$;

insert into rec_audit_logs(action, entity_type, entity_id, previous_value, new_value, reason, source)
select 'legacy_baseline.repaired_from_approved_spreadsheet','rec_users',user_id,
jsonb_build_object('display_name',current_display_name,'wins',current_wins,'losses',current_losses,'ties',current_ties,'playoff_wins',current_playoff_wins,'playoff_losses',current_playoff_losses,'superbowl_wins',current_superbowl_wins,'superbowl_losses',current_superbowl_losses,'point_differential',current_point_differential,'wallet_balance',current_wallet_balance,'savings_balance',current_savings_balance),
jsonb_build_object('display_name',display_name,'wins',wins,'losses',losses,'ties',ties,'playoff_wins',playoff_wins,'playoff_losses',playoff_losses,'superbowl_wins',superbowl_wins,'superbowl_losses',superbowl_losses,'point_differential',point_differential,'wallet_balance',wallet_balance,'savings_balance',savings_balance,'pending_purchases',pending_purchases,'pending_value_already_deducted',pending_value_already_deducted),
'Repaired legacy baseline to match approved migration spreadsheet uploaded after initial import.',
'admin_correction'::rec_source_type
from tmp_current;

insert into rec_dollar_ledger(user_id, amount, transaction_type, description, source, source_reference)
select user_id, wallet_balance-current_wallet_balance, 'legacy_wallet_repair','Wallet repaired to match approved migration spreadsheet.','admin_correction'::rec_source_type,jsonb_build_object('discord_id',discord_id,'old_wallet',current_wallet_balance,'new_wallet',wallet_balance)
from tmp_current where wallet_balance <> current_wallet_balance;

insert into rec_dollar_ledger(user_id, amount, transaction_type, description, source, source_reference)
select user_id, savings_balance-current_savings_balance, 'legacy_savings_repair','Savings repaired to match approved migration spreadsheet.','admin_correction'::rec_source_type,jsonb_build_object('discord_id',discord_id,'old_savings',current_savings_balance,'new_savings',savings_balance)
from tmp_current where savings_balance <> current_savings_balance;

update rec_users u set display_name = c.display_name from tmp_current c where u.id = c.user_id;
update rec_discord_accounts d set username = c.display_name, global_name = c.display_name from tmp_current c where d.user_id = c.user_id;
update rec_global_user_records r
set wins=c.wins, losses=c.losses, ties=c.ties, playoff_wins=c.playoff_wins, playoff_losses=c.playoff_losses,
superbowl_wins=c.superbowl_wins, superbowl_losses=c.superbowl_losses, point_differential=c.point_differential, legacy_locked=true
from tmp_current c where r.user_id=c.user_id;
update rec_wallets w set wallet_balance=c.wallet_balance, savings_balance=c.savings_balance from tmp_current c where w.user_id=c.user_id;
update rec_legacy_user_baselines b
set wallet_balance_start=c.wallet_balance, savings_balance_start=c.savings_balance, pending_purchase_count=c.pending_purchases,
global_record=jsonb_build_object('wins',c.wins,'losses',c.losses,'ties',c.ties,'playoff_wins',c.playoff_wins,'playoff_losses',c.playoff_losses,'superbowl_wins',c.superbowl_wins,'superbowl_losses',c.superbowl_losses,'point_differential',c.point_differential,'pending_value_already_deducted',c.pending_value_already_deducted),
unresolved_notes=case when c.pending_purchases>0 then 'Pending purchases existed in approved migration spreadsheet and are assumed already deducted.' else b.unresolved_notes end
from tmp_current c where b.user_id=c.user_id;

commit;
