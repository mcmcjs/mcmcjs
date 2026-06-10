data {
  int<lower=1> Num;
  array[Num] int nc;
  array[Num] int nt;
  array[Num] int rc;
  array[Num] int rt;
}

parameters {
  real d;
  real<lower=0> tau;
  array[Num] real mu;
  array[Num] real delta;
  real delta_new;
}

transformed parameters {
  array[Num] real pc;
  array[Num] real pt;
  for (i in 1:Num) {
    pc[i] = inv_logit(mu[i]);
    pt[i] = inv_logit(mu[i] + delta[i]);
  }
}

model {
  d ~ normal(0.0, 1.0 / sqrt(1.0E-6));
  tau ~ gamma(0.001, 0.001);
  mu ~ normal(0.0, 1.0 / sqrt(1.0E-5));
  delta ~ normal(d, 1.0 / sqrt(tau));
  rc ~ binomial(nc, pc);
  rt ~ binomial(nt, pt);
  delta_new ~ normal(d, 1.0 / sqrt(tau));
}

generated quantities {
  real sigma;
  sigma = 1 / sqrt(tau);
}
