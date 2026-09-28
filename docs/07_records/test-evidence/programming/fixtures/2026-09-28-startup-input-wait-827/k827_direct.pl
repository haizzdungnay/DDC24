#!/usr/bin/perl
# Bộ lấy mẫu trực tiếp cho Issue #827 T2/T3 — dùng được khi web đã dừng. Chỉ đọc. Mỗi mẫu có t (UTC ms) và m (CLOCK_MONOTONIC ms).
#  - Program: `point_snapshot` trên /run/mkddc/core.sock (một dòng JSON).
#  - Coil DO: vùng ext[] của /dev/shm/mkddc_plc_shm (value = coil đọc về, float64 @+24; mốc mẫu UTC ms @+40).
#  - Khung Modbus: op `frames` trên /run/mkddc/modbus-control.sock, mỗi 5 s.
# Dùng: perl k827_direct.pl <out.jsonl> <maxSeconds> [periodMs]. Dừng sớm khi có /tmp/k827d.stop.
use strict; use warnings;
use IO::Socket::UNIX; use Time::HiRes qw(time sleep clock_gettime CLOCK_MONOTONIC); use JSON::PP;

my ($out, $max, $period) = @ARGV;
$period ||= 250;
my $json = JSON::PP->new->canonical;
my @names = map { my $d = $_; map { "CK5080$d-DO$_" } 1 .. 8 } (4, 5);
my $id = 70000;

sub line_rpc {
  my ($path, $req) = @_;
  my $s = IO::Socket::UNIX->new(Peer => $path, Timeout => 2) or return undef;
  print $s $json->encode($req), "\n";
  my $l = <$s>; close $s;
  return undef unless defined $l;
  return eval { $json->decode($l) };
}

sub read_do {
  open my $f, '<:raw', '/dev/shm/mkddc_plc_shm' or return undef;
  local $/; my $buf = <$f>; close $f;
  my %do;
  for my $n (@names) {
    my $pos = index($buf, $n . "\0");
    next if $pos < 0;
    my $v = unpack('d<', substr($buf, $pos + 24, 8));
    my $ts = unpack('q<', substr($buf, $pos + 40, 8));
    my $q = unpack('C', substr($buf, $pos + 56, 1));
    $do{$n} = [ ($v > 0.5 ? 1 : 0), $q, $ts ];
  }
  return \%do;
}

open my $o, '>', $out or die "open $out: $!";
select((select($o), $| = 1)[0]);
my $t0 = time; my $n = 0; my $lastFr = 0; my $lastFrameAt = 0;
while (time - $t0 < $max) {
  last if -e '/tmp/k827d.stop';
  my $ts = time; my %rec = (t => int($ts * 1000), m => int(clock_gettime(CLOCK_MONOTONIC) * 1000));
  my $snap = line_rpc('/run/mkddc/core.sock', { id => $id++, op => 'point_snapshot', user => 'k827probe' });
  if (!$snap) {
    $rec{core} = 'UNREACHABLE';
  } elsif (($snap->{result} // '') ne 'accepted') {
    $rec{core} = 'result=' . ($snap->{result} // '?');
  } else {
    $rec{core} = 'ok';
    $rec{safe} = [ $snap->{safeState} ? 1 : 0, $snap->{safeStateNoControllerOnly} ? 1 : 0 ];
    $rec{task} = $snap->{task} ? $snap->{task}{state} : undef;
    $rec{prog} = [ map { my $p = $_; +{ map { $_ => $p->{$_} } qw(instanceId state enabled waitingReason faultCount lastFaultCode lastRunMonoNs) } } @{ $snap->{programs} || [] } ];
    $rec{mono} = $snap->{capturedMonotonicNs};
  }
  $rec{do} = read_do();
  if ($ts - $lastFr >= 5) {
    $lastFr = $ts;
    my $fr = line_rpc('/run/mkddc/modbus-control.sock', { op => 'frames', bus => 1, limit => 200 });
    if ($fr && ref $fr->{frames} eq 'ARRAY') {
      my @new = grep { $_->{at} >= $lastFrameAt } @{ $fr->{frames} };
      for (@new) { $lastFrameAt = $_->{at} if $_->{at} > $lastFrameAt; }
      $rec{fr} = [ map { [ $_->{at}, $_->{slave}, $_->{fc}, $_->{addr}, $_->{count}, ($_->{ok} ? 1 : 0), $_->{values} ] } @new ];
    } else {
      $rec{fr} = 'UNREACHABLE';
    }
  }
  print $o $json->encode(\%rec), "\n";
  $n++;
  my $wait = $period / 1000 - (time - $ts);
  sleep($wait) if $wait > 0;
}
close $o;
print "samples=$n\n";
